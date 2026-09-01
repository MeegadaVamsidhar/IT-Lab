import base64, hashlib, json, mimetypes, os, queue, shutil, sqlite3, threading, time, uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data')
STORE = os.path.join(DATA, 'objects')
DB_PATH = os.path.join(DATA, 'localcloud.db')
os.makedirs(STORE, exist_ok=True)
DB_LOCK = threading.Lock()
EVENTS = queue.Queue()
SESSIONS = {}
SESSION_LOCK = threading.Lock()
DOWNLOAD_TICKETS = {}
DOWNLOAD_LOCK = threading.Lock()
CHUNK_SIZE = int(os.environ.get('LOCALCLOUD_CHUNK_MB', '8')) * 1024 * 1024
MAX_FILE_SIZE = int(os.environ.get('LOCALCLOUD_MAX_FILE_GB', '50')) * 1024 ** 3

def db():
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    return c

def init_db():
    with db() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, display_name TEXT, role TEXT DEFAULT 'member', avatar TEXT);
        CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, name TEXT, size INTEGER, mime TEXT, owner_id INTEGER, status TEXT, checksum TEXT, created_at REAL, updated_at REAL, node_id TEXT);
        CREATE TABLE IF NOT EXISTS permissions(file_id TEXT, user_id INTEGER, access TEXT, PRIMARY KEY(file_id,user_id));
        CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, file_id TEXT, user_id INTEGER, total_size INTEGER, chunk_size INTEGER, received INTEGER, status TEXT, started_at REAL, updated_at REAL, error TEXT);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, message TEXT, file_id TEXT, user_id INTEGER, meta TEXT, created_at REAL);
        CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY, label TEXT, status TEXT, capacity INTEGER, used INTEGER, active_transfers INTEGER, latency INTEGER, updated_at REAL);
        ''')
        users = [('admin','System Admin','admin','AD'),('alice','Alice Johnson','member','AJ'),('bob','Bob Smith','member','BS')]
        for u in users: c.execute('INSERT OR IGNORE INTO users(username,display_name,role,avatar) VALUES(?,?,?,?)', u)
        now=time.time()
        nodes=[('node-a','Primary Node','online',500*1024**3,0,0,12,now),('node-b','Replica Node','online',500*1024**3,0,0,24,now),('node-c','Archive Node','degraded',1000*1024**3,0,0,48,now)]
        for n in nodes: c.execute('INSERT OR IGNORE INTO nodes VALUES(?,?,?,?,?,?,?,?)', n)

def log(kind, message, file_id=None, user_id=None, meta=None):
    EVENTS.put((kind,message,file_id,user_id,meta))

def event_worker():
    while True:
        item=EVENTS.get()
        try:
            with db() as c: c.execute('INSERT INTO events(kind,message,file_id,user_id,meta,created_at) VALUES(?,?,?,?,?,?)', (*item, time.time(),))
        except Exception: pass

def user(uid):
    with db() as c: return c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()

def can_access(file_id, uid, needed='viewer'):
    with db() as c:
        f=c.execute('SELECT * FROM files WHERE id=?',(file_id,)).fetchone()
        if not f: return None, False
        u=c.execute('SELECT role FROM users WHERE id=?',(uid,)).fetchone()
        if u and u['role']=='admin': return f, True
        if f['owner_id']==uid: return f, True
        p=c.execute('SELECT access FROM permissions WHERE file_id=? AND user_id=?',(file_id,uid)).fetchone()
        levels={'viewer':1,'editor':2,'owner':3}
        return f, bool(p and levels.get(p['access'],0)>=levels.get(needed,1))

def choose_node(size):
    with db() as c:
        rows=c.execute('SELECT * FROM nodes WHERE status!=\'offline\' ORDER BY (active_transfers*1000 + latency), used').fetchall()
        for n in rows:
            if n['capacity']-n['used'] >= size: return n['id']
    return 'node-a'

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args): pass
    def send_json(self, obj, status=200):
        raw=json.dumps(obj).encode(); self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(raw))); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers(); self.wfile.write(raw)
    def body(self):
        n=int(self.headers.get('Content-Length','0')); return self.rfile.read(n)
    def authenticated_user(self):
        auth=self.headers.get('Authorization','')
        token=auth[7:] if auth.startswith('Bearer ') else ''
        with SESSION_LOCK: uid=SESSIONS.get(token)
        return user(uid) if uid else None
    def route(self):
        p=urlparse(self.path); path=p.path; q=parse_qs(p.query)
        if path=='/api/health': return self.health()
        if path=='/api/users':
            with db() as c: return self.send_json({'users':[dict(x) for x in c.execute('SELECT * FROM users').fetchall()]})
        if path=='/api/login' and self.command=='POST':
            d=json.loads(self.body()); with_db=db();
            with with_db as c: u=c.execute('SELECT * FROM users WHERE username=?',(d.get('username',''),)).fetchone()
            if not u: return self.send_json({'error':'Unknown user'},401)
            token=uuid.uuid4().hex
            with SESSION_LOCK: SESSIONS[token]=u['id']
            log('security',f"{u['display_name']} signed in",None,u['id'])
            return self.send_json({'user':dict(u),'token':token})
        if path.startswith('/api/download/') and self.command=='GET': return self.ticket_download(path.split('/')[3])
        if not path.startswith('/api/'):
            if path=='/': return self.static('index.html')
            return self.static(path.lstrip('/'))
        current=self.authenticated_user()
        if not current: return self.send_json({'error':'Authentication required'},401)
        self.current_user=current
        if path=='/api/logout' and self.command=='POST': return self.logout()
        if path=='/api/dashboard': return self.dashboard(current)
        if path=='/api/files' and self.command=='GET': return self.dashboard(current)
        if path=='/api/upload/init' and self.command=='POST': return self.upload_init(current)
        if path.startswith('/api/upload/') and path.endswith('/chunk') and self.command=='PUT': return self.upload_chunk(path.split('/')[3])
        if path.startswith('/api/upload/') and path.endswith('/complete') and self.command=='POST': return self.upload_complete(path.split('/')[3])
        if path.startswith('/api/files/') and path.endswith('/download') and self.command=='GET': return self.download(path.split('/')[3],current['id'])
        if path.startswith('/api/files/') and path.endswith('/download-ticket') and self.command=='POST': return self.download_ticket(path.split('/')[3],current)
        if path.startswith('/api/files/') and path.endswith('/permissions') and self.command=='POST': return self.permissions(path.split('/')[3],current)
        if path.startswith('/api/files/') and self.command=='DELETE': return self.delete_file(path.split('/')[3],current)
        if path=='/api/events':
            with db() as c:
                sql='SELECT * FROM events ORDER BY id DESC LIMIT 50' if current['role']=='admin' else 'SELECT * FROM events WHERE user_id=? ORDER BY id DESC LIMIT 50'
                args=() if current['role']=='admin' else (current['id'],)
                return self.send_json({'events':[dict(x) for x in c.execute(sql,args).fetchall()]})
        if path=='/api/nodes':
            with db() as c: return self.send_json({'nodes':[dict(x) for x in c.execute('SELECT * FROM nodes').fetchall()]})
        if path.startswith('/api/nodes/') and path.endswith('/toggle') and self.command=='POST': return self.toggle_node(path.split('/')[3],current)
        return self.send_json({'error':'Not found'},404)
    def logout(self):
        auth=self.headers.get('Authorization','')
        token=auth[7:] if auth.startswith('Bearer ') else ''
        with SESSION_LOCK: SESSIONS.pop(token,None)
        return self.send_json({'ok':True})
    def health(self):
        with db() as c:
            nodes=[dict(x) for x in c.execute('SELECT * FROM nodes').fetchall()]; online=sum(n['status']!='offline' for n in nodes)
        return self.send_json({'ok':True,'online_nodes':online,'total_nodes':len(nodes),'queue_depth':EVENTS.qsize()})
    def dashboard(self,current):
        uid=current['id']
        with db() as c:
            if current['role']=='admin':
                files=[dict(x) for x in c.execute('SELECT f.*,u.display_name owner_name FROM files f JOIN users u ON u.id=f.owner_id ORDER BY f.updated_at DESC').fetchall()]
            else:
                files=[dict(x) for x in c.execute('SELECT f.*,u.display_name owner_name FROM files f JOIN users u ON u.id=f.owner_id WHERE f.owner_id=? OR f.id IN (SELECT file_id FROM permissions WHERE user_id=?) ORDER BY f.updated_at DESC',(uid,uid)).fetchall()]
            nodes=[dict(x) for x in c.execute('SELECT * FROM nodes').fetchall()]; uploads=[dict(x) for x in c.execute('SELECT * FROM uploads WHERE user_id=? AND status=\'active\'',(uid,)).fetchall()]
        return self.send_json({'files':files,'nodes':nodes,'uploads':uploads,'events':[]})
    def upload_init(self,current):
        d=json.loads(self.body()); uid=current['id']; size=int(d['size']); fid=str(uuid.uuid4()); sid=str(uuid.uuid4()); node=choose_node(size); now=time.time()
        if size <= 0: return self.send_json({'error':'File is empty'},400)
        if size > MAX_FILE_SIZE: return self.send_json({'error':f'File exceeds the configured {MAX_FILE_SIZE // 1024**3} GB limit'},413)
        if shutil.disk_usage(DATA).free < size + CHUNK_SIZE: return self.send_json({'error':'Insufficient local storage'},507)
        with db() as c:
            c.execute('INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?,?)',(fid,d['name'],size,d.get('mime','application/octet-stream'),uid,'uploading','',now,now,node)); c.execute('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?,?)',(sid,fid,uid,size,CHUNK_SIZE,0,'active',now,now,''))
        with open(os.path.join(STORE,sid+'.part'),'wb') as f: f.truncate(size)
        log('upload','Upload session created for '+d['name'],fid,uid,{'node':node}); return self.send_json({'upload_id':sid,'file_id':fid,'chunk_size':CHUNK_SIZE})
    def upload_chunk(self,sid):
        with db() as c: up=c.execute('SELECT * FROM uploads WHERE id=?',(sid,)).fetchone()
        if not up: return self.send_json({'error':'Upload not found'},404)
        if up['user_id']!=self.current_user['id'] and self.current_user['role']!='admin': return self.send_json({'error':'Access denied'},403)
        idx=int(self.headers.get('X-Chunk-Index','0')); data=self.body(); offset=idx*up['chunk_size']
        with open(os.path.join(STORE,sid+'.part'),'r+b') as f: f.seek(offset); f.write(data)
        received=min(up['total_size'], max(up['received'],offset+len(data)))
        with db() as c: c.execute('UPDATE uploads SET received=?,updated_at=? WHERE id=?',(received,time.time(),sid))
        return self.send_json({'received':received,'total':up['total_size'],'percent':round(received*100/up['total_size'],1)})
    def upload_complete(self,sid):
        with db() as c: up=c.execute('SELECT * FROM uploads WHERE id=?',(sid,)).fetchone()
        if not up: return self.send_json({'error':'Upload not found'},404)
        if up['user_id']!=self.current_user['id'] and self.current_user['role']!='admin': return self.send_json({'error':'Access denied'},403)
        part=os.path.join(STORE,sid+'.part'); h=hashlib.sha256();
        with open(part,'rb') as f:
            for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
        final=os.path.join(STORE,up['file_id']); os.replace(part,final)
        with db() as c: c.execute('UPDATE uploads SET status=\'complete\',updated_at=? WHERE id=?',(time.time(),sid)); c.execute('UPDATE files SET status=\'available\',checksum=?,updated_at=? WHERE id=?',(h.hexdigest(),time.time(),up['file_id']))
        log('upload','Upload completed',up['file_id'],up['user_id'],{'checksum':h.hexdigest()}); return self.send_json({'ok':True,'checksum':h.hexdigest()})
    def download(self,fid,uid):
        f,ok=can_access(fid,uid,'viewer')
        if not ok or f['status']!='available': return self.send_json({'error':'Access denied or file unavailable'},403)
        path=os.path.join(STORE,fid); size=os.path.getsize(path); start=0; end=size-1; rng=self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            a,b=(rng[6:].split('-',1)+[''])[:2]; start=int(a or 0); end=int(b or size-1); self.send_response(206); self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        else: self.send_response(200)
        self.send_header('Content-Type',f['mime']); self.send_header('Content-Length',str(end-start+1)); self.send_header('Content-Disposition',f"attachment; filename*=UTF-8''{f['name']}"); self.end_headers()
        with open(path,'rb') as x:
            x.seek(start); remaining=end-start+1
            while remaining:
                chunk=x.read(min(1024*1024,remaining))
                if not chunk: break
                self.wfile.write(chunk); remaining-=len(chunk)
        log('download',f"Downloaded {f['name']}",fid,uid)
    def download_ticket(self,fid,current):
        f,ok=can_access(fid,current['id'],'viewer')
        if not ok or f['status']!='available': return self.send_json({'error':'Access denied or file unavailable'},403)
        ticket=uuid.uuid4().hex
        with DOWNLOAD_LOCK: DOWNLOAD_TICKETS[ticket]=(fid,current['id'],time.time()+60)
        return self.send_json({'url':'/api/download/'+ticket})
    def ticket_download(self,ticket):
        with DOWNLOAD_LOCK: entry=DOWNLOAD_TICKETS.pop(ticket,None)
        if not entry or entry[2] < time.time(): return self.send_json({'error':'Download link expired'},401)
        return self.download(entry[0],entry[1])
    def permissions(self,fid,current):
        d=json.loads(self.body()); uid=current['id']; f,ok=can_access(fid,uid,'owner')
        if current['role']=='admin' and f: ok=True
        if not ok: return self.send_json({'error':'Only the owner can change sharing'},403)
        target=int(d['user_id']); access=d['access']
        if access not in ('viewer','editor'): return self.send_json({'error':'Invalid access level'},400)
        with db() as c:
            if not c.execute('SELECT id FROM users WHERE id=?',(target,)).fetchone(): return self.send_json({'error':'User not found'},404)
            c.execute('INSERT OR REPLACE INTO permissions VALUES(?,?,?)',(fid,target,access))
        log('policy',f"Permission changed to {access}",fid,uid,{'target':target}); return self.send_json({'ok':True})
    def delete_file(self,fid,current):
        if current['role']!='admin': return self.send_json({'error':'Administrator access required'},403)
        with db() as c:
            f=c.execute('SELECT * FROM files WHERE id=?',(fid,)).fetchone()
            if not f: return self.send_json({'error':'File not found'},404)
            uploads=c.execute('SELECT id FROM uploads WHERE file_id=?',(fid,)).fetchall()
            c.execute('DELETE FROM permissions WHERE file_id=?',(fid,))
            c.execute('DELETE FROM uploads WHERE file_id=?',(fid,))
            c.execute('DELETE FROM files WHERE id=?',(fid,))
        stored_paths=[os.path.join(STORE,fid)]+[os.path.join(STORE,u['id']+'.part') for u in uploads]
        for stored_path in stored_paths:
            if os.path.isfile(stored_path): os.remove(stored_path)
        log('delete',f"Deleted {f['name']}",fid,current['id'],{'owner_id':f['owner_id']})
        return self.send_json({'ok':True})
    def toggle_node(self,nid,current):
        if current['role']!='admin': return self.send_json({'error':'Administrator access required'},403)
        with db() as c:
            n=c.execute('SELECT status FROM nodes WHERE id=?',(nid,)).fetchone(); new='offline' if n['status']!='offline' else 'online'; c.execute('UPDATE nodes SET status=?,updated_at=? WHERE id=?',(new,time.time(),nid))
        log('system',f'Node {nid} marked {new}'); return self.send_json({'status':new})
    def static(self,rel):
        if '..' in rel: return self.send_error(403)
        path=os.path.join(ROOT,'static',rel or 'index.html')
        if not os.path.isfile(path): return self.send_error(404)
        typ=mimetypes.guess_type(path)[0] or 'application/octet-stream'; data=open(path,'rb').read(); self.send_response(200); self.send_header('Content-Type',typ); self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','public, max-age=3600'); self.send_header('ETag',f'W/"{os.path.getmtime(path):.0f}-{len(data)}"'); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        try:self.route()
        except Exception as e:self.send_json({'error':str(e)},500)
    def do_POST(self):
        try:self.route()
        except Exception as e:self.send_json({'error':str(e)},500)
    def do_PUT(self):
        try:self.route()
        except Exception as e:self.send_json({'error':str(e)},500)
    def do_DELETE(self):
        try:self.route()
        except Exception as e:self.send_json({'error':str(e)},500)

if __name__=='__main__':
    init_db(); threading.Thread(target=event_worker,daemon=True).start(); print('LocalCloud running at http://localhost:8080'); ThreadingHTTPServer(('localhost',8080),Handler).serve_forever()
