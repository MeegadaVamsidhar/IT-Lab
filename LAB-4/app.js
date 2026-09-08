const navItems = document.querySelectorAll('[data-view]');
const views = document.querySelectorAll('.view');
const breadcrumb = document.getElementById('breadcrumb-title');
const toast = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
let toastTimer;
let apiEvents = [];
let currentUser = null;
let customerOrders = [];
let selectedRole = 'customer';

async function apiRequest(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function connectToDatabase() {
  try {
    const data = await apiRequest('/api/events');
    apiEvents = data.events;
    renderCustomerEvents();
    document.querySelector('.system-health strong').textContent = 'SQLite database connected';
    document.querySelector('.system-health small').textContent = `${apiEvents.length} events loaded from local storage`;
  } catch {
    // Direct file opening remains supported as a visual-only demo.
  }
}

function showToast(message) {
  toastText.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function setView(viewName) {
  views.forEach(view => view.classList.toggle('active-view', view.dataset.panel === viewName));
  document.querySelectorAll('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === viewName));
  breadcrumb.textContent = viewName.charAt(0).toUpperCase() + viewName.slice(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setRole(role) {
  const customer = role === 'customer';
  document.body.classList.toggle('customer-mode', customer);
  document.querySelectorAll('.role-button').forEach(button => button.classList.toggle('active', button.dataset.role === role));
  document.getElementById('workspace-name').textContent = customer ? (currentUser?.email?.split('@')[0] || 'Guest') : 'Aster Studios';
  document.getElementById('workspace-role').textContent = customer ? 'Customer dashboard' : 'Organizer workspace';
  document.querySelector('.user-card strong').textContent = customer ? (currentUser?.email?.split('@')[0] || 'Guest') : 'Alex Kim';
  document.querySelector('.user-card small').textContent = customer ? 'Customer' : 'Owner · Organizer';
  document.querySelectorAll('#account-button, #customer-account, #profile-account').forEach(button => {
    button.hidden = Boolean(currentUser);
  });
  setView(customer ? 'discover' : 'overview');
  if (customer) renderCustomerEvents();
}

function openAccessModal(role = selectedRole) {
  selectedRole = role;
  document.querySelectorAll('.access-role').forEach(button => button.classList.toggle('active', button.dataset.accessRole === role));
  const registerTab = document.querySelector('.auth-tab:last-child');
  registerTab.disabled = role === 'organizer';
  if (role === 'organizer') document.querySelector('.auth-tab:first-child').click();
  document.getElementById('auth-modal').classList.add('open');
  document.getElementById('auth-note').textContent = role === 'organizer' ? 'Organizer sign in is restricted to authorized accounts.' : 'Customer accounts can be created here.';
}

document.querySelectorAll('.access-role').forEach(button => button.addEventListener('click', () => openAccessModal(button.dataset.accessRole)));
document.querySelectorAll('.role-button').forEach(button => button.addEventListener('click', () => {
  openAccessModal(button.dataset.role);
}));

function renderCustomerEvents(filter = 'all') {
  const target = document.getElementById('customer-events');
  if (!target) return;
  const visibleEvents = apiEvents.filter(event => filter === 'all' || event.category === filter);
  target.innerHTML = visibleEvents.map(event => {
    const available = event.capacity - event.sold;
    const takenSeats = Math.max(2, Math.round(event.soldPercent / 10));
    const seatDots = Array.from({ length: 18 }, (_, index) => `<i class="${index < takenSeats ? 'taken' : ''}"></i>`).join('');
    return `<article class="customer-event-card"><div class="customer-event-art ${event.category.toLowerCase().replaceAll(' ', '-')}" ><span>${event.category}</span><strong>${new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong></div><div class="customer-event-body"><h2>${event.name}</h2><p>${event.venue} · ${new Date(event.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p><div class="availability"><span><i></i>${available.toLocaleString()} seats available</span><strong>From $${event.currentPrice}</strong></div><div class="seat-preview">${seatDots}</div><button class="primary-button book-event" data-event-id="${event.id}">Choose seats →</button></div></article>`;
  }).join('') || '<div class="empty-state"><h2>No events in this category.</h2><p>Try another filter to see what is happening soon.</p></div>';
  target.querySelectorAll('.book-event').forEach(button => button.addEventListener('click', () => openBooking(Number(button.dataset.eventId))));
}

function openBooking(eventId) {
  const event = apiEvents.find(item => item.id === eventId);
  if (!event) return;
  document.getElementById('booking-event-name').textContent = event.name;
  document.getElementById('booking-event-meta').textContent = `${event.venue} · ${new Date(event.date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
  document.getElementById('booking-available').textContent = `${(event.capacity - event.sold).toLocaleString()} seats remaining`;
  document.getElementById('booking-quantity').value = 1;
  document.getElementById('booking-price').textContent = `$${event.currentPrice}`;
  document.getElementById('seat-step').classList.remove('hidden');
  document.getElementById('payment-step').classList.remove('active');
  document.querySelector('input[name="payment-method"][value="card"]').checked = true;
  document.querySelectorAll('.payment-option').forEach(option => option.classList.toggle('active', option.querySelector('input').checked));
  document.getElementById('card-fields').classList.remove('hidden');
  document.getElementById('upi-fields').classList.add('hidden');
  ['card-name', 'card-number', 'card-expiry', 'card-cvv', 'upi-id'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('booking-step-label').textContent = 'Step 1 of 2 · Choose your seats';
  document.getElementById('confirm-booking').dataset.eventId = event.id;
  document.getElementById('confirm-booking').dataset.step = 'seats';
  document.getElementById('confirm-booking').textContent = 'Continue to payment';
  document.getElementById('booking-modal').classList.add('open');
}

function renderTickets() {
  const list = document.getElementById('ticket-list');
  document.getElementById('ticket-count').textContent = customerOrders.length;
  if (!customerOrders.length) return;
  list.innerHTML = customerOrders.map(order => `<article class="ticket-card"><div><span class="eyebrow">Digital ticket · ${order.orderCode}</span><h2>${order.event}</h2><p>${order.quantity} ${order.quantity === 1 ? 'seat' : 'seats'} · Paid $${order.amount}</p></div><button class="secondary-button">View ticket</button></article>`).join('');
}

navItems.forEach(item => item.addEventListener('click', () => {
  if (item.dataset.view) setView(item.dataset.view);
}));

document.querySelectorAll('.panel-link, .text-button').forEach(button => button.addEventListener('click', () => {
  const target = button.dataset.view;
  if (target) setView(target);
}));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.view === 'tickets') renderTickets();
}));
document.querySelectorAll('.filter-pill').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter-pill').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  renderCustomerEvents(button.dataset.filter);
}));

const modal = document.getElementById('modal');
const openModal = () => modal.classList.add('open');
const closeModal = () => modal.classList.remove('open');
document.getElementById('create-event').addEventListener('click', openModal);
document.getElementById('create-event-alt').addEventListener('click', openModal);
document.getElementById('close-modal').addEventListener('click', closeModal);
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
document.getElementById('save-event').addEventListener('click', () => {
  const name = document.getElementById('new-event-name').value.trim() || 'Untitled event';
  closeModal();
  showToast(`${name} saved as a draft`);
  document.getElementById('new-event-name').value = '';
});

const authModal = document.getElementById('auth-modal');
document.getElementById('account-button').addEventListener('click', () => openAccessModal('customer'));
document.querySelectorAll('#customer-account, #profile-account').forEach(button => button.addEventListener('click', () => openAccessModal('customer')));
document.getElementById('close-auth').addEventListener('click', () => {
  if (currentUser) authModal.classList.remove('open');
  else showToast('Choose a role and verify your password to continue.');
});
authModal.addEventListener('click', event => {
  if (event.target === authModal && currentUser) authModal.classList.remove('open');
});
document.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.auth-tab').forEach(item => item.classList.remove('active'));
  tab.classList.add('active');
  document.querySelector('.auth-modal h2').textContent = tab.textContent === 'Sign in' ? 'Verify your access.' : 'Create your customer account.';
  document.querySelector('#auth-submit').textContent = tab.textContent === 'Sign in' ? 'Continue securely' : 'Create account';
}));
document.getElementById('auth-submit').addEventListener('click', async () => {
  const isRegistering = document.querySelector('.auth-tab.active').textContent === 'Create account';
  const endpoint = isRegistering ? '/api/auth/register' : '/api/auth/login';
  if (isRegistering && selectedRole === 'organizer') return showToast('Organizer accounts require administrator approval.');
  const credentials = { email: document.getElementById('auth-email').value, password: document.getElementById('auth-password').value, role: selectedRole };
  try {
    const data = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(credentials) });
    currentUser = data.user;
    document.getElementById('profile-email').textContent = currentUser.email;
    document.getElementById('profile-copy').textContent = 'Your tickets and booking history are synced across devices.';
    document.getElementById('profile-avatar').textContent = currentUser.email.slice(0, 2).toUpperCase();
    setRole(selectedRole);
    authModal.classList.remove('open');
    showToast(isRegistering ? 'Account created - tickets synced across devices' : 'Identity verified - tickets synced across devices');
  } catch (error) {
    showToast(error.message);
  }
});
document.querySelectorAll('.buy-button').forEach(button => button.addEventListener('click', async () => {
  const event = apiEvents.find(item => item.name === button.dataset.event);
  if (!event) return showToast(`Secure checkout started for ${button.dataset.event}`);
  try {
    const data = await apiRequest('/api/orders', { method: 'POST', body: JSON.stringify({ eventId: event.id, userId: currentUser?.id, quantity: 1 }) });
    showToast(`${data.order.orderCode} confirmed for ${data.order.event}`);
  } catch (error) {
    showToast(error.message);
  }
}));

document.getElementById('booking-quantity').addEventListener('input', event => {
  const eventData = apiEvents.find(item => item.id === Number(document.getElementById('confirm-booking').dataset.eventId));
  if (eventData) document.getElementById('booking-price').textContent = `$${eventData.currentPrice * Math.max(1, Number(event.target.value))}`;
});
document.getElementById('close-booking').addEventListener('click', () => document.getElementById('booking-modal').classList.remove('open'));
document.getElementById('confirm-booking').addEventListener('click', async event => {
  const quantity = Math.max(1, Number(document.getElementById('booking-quantity').value));
  const eventData = apiEvents.find(item => item.id === Number(event.target.dataset.eventId));
  if (event.target.dataset.step === 'seats') {
    if (!eventData || quantity > eventData.capacity - eventData.sold) return showToast('Choose seats within the remaining capacity.');
    document.getElementById('seat-step').classList.add('hidden');
    document.getElementById('payment-step').classList.add('active');
    document.getElementById('booking-step-label').textContent = 'Step 2 of 2 · Payment';
    event.target.dataset.step = 'payment';
    event.target.textContent = `Pay $${eventData.currentPrice * quantity}`;
    return;
  }
  const method = document.querySelector('input[name="payment-method"]:checked').value;
  const paymentValid = method === 'card'
    ? ['card-name', 'card-number', 'card-expiry', 'card-cvv'].every(id => document.getElementById(id).value.trim())
    : document.getElementById('upi-id').value.trim().includes('@');
  if (!paymentValid) return showToast(method === 'card' ? 'Complete the card details to pay.' : 'Enter a valid UPI ID to pay.');
  event.target.disabled = true;
  event.target.textContent = 'Processing payment...';
  try {
    await new Promise(resolve => setTimeout(resolve, 700));
    const data = await apiRequest('/api/orders', { method: 'POST', body: JSON.stringify({ eventId: Number(event.target.dataset.eventId), userId: currentUser?.id, quantity }) });
    customerOrders.unshift(data.order);
    renderTickets();
    document.getElementById('booking-modal').classList.remove('open');
    showToast(`${data.order.orderCode} confirmed - your seats are reserved`);
    await connectToDatabase();
  } catch (error) { showToast(error.message); }
  finally { event.target.disabled = false; event.target.textContent = 'Pay now'; }
});

document.querySelectorAll('input[name="payment-method"]').forEach(input => input.addEventListener('change', event => {
  document.querySelectorAll('.payment-option').forEach(option => option.classList.toggle('active', option.querySelector('input').checked));
  document.getElementById('card-fields').classList.toggle('hidden', event.target.value !== 'card');
  document.getElementById('upi-fields').classList.toggle('hidden', event.target.value !== 'upi');
}));

document.getElementById('new-rule').addEventListener('click', () => showToast('Pricing rule builder opened'));
document.querySelectorAll('.switch input').forEach(input => input.addEventListener('change', () => showToast(input.checked ? 'Pricing rule activated' : 'Pricing rule paused')));

const slider = document.getElementById('capacity-slider');
const capacityLabel = document.getElementById('capacity-label');
const simPrice = document.getElementById('sim-price');
const simMessage = document.getElementById('sim-message');
const trackFill = document.getElementById('price-track-fill');
function updateSimulator() {
  const capacity = Number(slider.value);
  capacityLabel.textContent = `${capacity}%`;
  trackFill.style.width = `${capacity}%`;
  if (capacity >= 75) {
    simPrice.textContent = '$66';
    simMessage.textContent = 'Capacity surge · +12% adjustment';
    simMessage.style.color = '#c66d34';
  } else if (capacity <= 15) {
    simPrice.textContent = '$50';
    simMessage.textContent = 'Early bird · -15% adjustment';
    simMessage.style.color = '#4e75a7';
  } else {
    simPrice.textContent = '$59';
    simMessage.textContent = 'Base price · No adjustment';
    simMessage.style.color = '#3b9a6d';
  }
}
slider.addEventListener('input', updateSimulator);

const orderSearch = document.getElementById('order-search');
orderSearch.addEventListener('input', () => {
  const query = orderSearch.value.toLowerCase();
  document.querySelectorAll('#orders-table tr').forEach(row => row.style.display = row.textContent.toLowerCase().includes(query) ? '' : 'none');
});

document.getElementById('simulate-fault').addEventListener('click', event => {
  event.target.textContent = 'Recovering services...';
  showToast('Fault detected: retry queue engaged');
  setTimeout(() => { event.target.textContent = 'Simulate fault'; showToast('All services recovered'); }, 2200);
});

document.getElementById('sales-period').addEventListener('change', event => showToast(`Sales view updated to ${event.target.value.toLowerCase()}`));

setTimeout(() => showToast('Live activity stream connected'), 900);
openAccessModal('customer');
connectToDatabase();
