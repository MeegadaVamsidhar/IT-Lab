# UG/PG Request Approvals

UG/PG Request Approvals is a workflow-based departmental activity management application for UG/PG programmes. It supports HOD and faculty approval queues, activity submission, project allocation visibility, and role-aware department operations.

## Roles and demo accounts

- **Student**: `student@reqmail.com` / `student123` — submits permission requests and tracks workflow items.
- **Faculty**: `faculty@reqmail.com` / `faculty123` — submits academic/faculty permission requests.
- **Admin**: `admin@reqmail.com` / `admin123` — reviews requests and approves or requests changes.

The API uses a server-side session token after login. Approval endpoints are restricted to Admin accounts.
Student requests follow a mandatory two-step approval chain: **Pending Faculty → Pending HOD → Approved**. Faculty approval is required before the Admin/HOD can complete the request.

## Run locally

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). SQLite data is stored in `data/deptflow.db` and is created automatically on first start.

## Workflow

1. A Student submits a request using **Request permission**, including the **Programme date**. The signed-in user's name is recorded automatically and shown as the requesting user. It enters the queue as **Pending Faculty**.
2. All Faculty users can see student requests. Any Faculty reviewer can approve a request, moving it to **Pending HOD**, or request changes. Faculty cannot complete a request directly.
3. The Admin/HOD approves the faculty-reviewed request, moving it to **Approved**, or requests changes. Admin cannot approve a request still waiting for Faculty.
4. Approval inbox, project allocation, and people are available from the left navigation.

## API

- `GET /api/summary` - dashboard counts
- `GET /api/activities` - activity register, with optional `?status=...`
- `POST /api/activities` - submit a new workflow item
- `PATCH /api/activities/:id` - update an activity status
- `GET /api/projects` - project allocation register
