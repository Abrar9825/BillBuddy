const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const { customAlphabet } = require('nanoid');
const app = express();
const dotenv = require('dotenv');
dotenv.config();

const PORT = process.env.PORT || 3000;
// Nano ID (6-digit numeric)
const nanoid = customAlphabet('0123456789', 6);

// MongoDB Setup
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// Models
const trackerSchema = new mongoose.Schema({
  trackerId: { type: String, unique: true },
  groupName: String,
  createdBy: String,
});
const memberSchema = new mongoose.Schema({
  trackerId: String,
  name: String,
  number: String,
  permission: { type: String, enum: ['read', 'write', 'leader'] },
  amount: { type: Number, default: 0 },
});
const userSchema = new mongoose.Schema({
  number: { type: String, unique: true },
  name: String,
  trackers: [String],
});
const Tracker = mongoose.model('Tracker', trackerSchema);
const Member = mongoose.model('Member', memberSchema);
const User = mongoose.model('User', userSchema);

// Middleware
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Home (Create Tracker & Join by ID)
app.get('/', (req, res) => {
  res.render('index');
});

// Create Tracker
app.post('/create-tracker', async (req, res) => {
  const { groupName, name, number } = req.body;

  let trackerId;
  let exists;
  do {
    trackerId = nanoid();
    exists = await Tracker.findOne({ trackerId });
  } while (exists);

  await Tracker.create({ trackerId, groupName, createdBy: number });
  await Member.create({ trackerId, name, number, permission: 'leader' });

  let user = await User.findOne({ number });
  if (user) {
    user.name = name;
    if (!user.trackers.includes(trackerId)) {
      user.trackers.push(trackerId);
    }
    await user.save();
  } else {
    await User.create({ number, name, trackers: [trackerId] });
  }

  res.redirect(`/dashboard/${trackerId}?user=${number}`);
});

// AJAX Validate Tracker ID
app.get('/api/validate-tracker', async (req, res) => {
  const { trackerId } = req.query;
  if (!trackerId || trackerId.length !== 6) return res.json({ valid: false });
  const exists = await Tracker.findOne({ trackerId });
  res.json({ valid: !!exists });
});

// Go to join form (after trackerId is validated)
app.get('/join', (req, res) => {
  const { trackerId } = req.query;
  if (!trackerId) return res.redirect('/');
  res.render('join', { trackerId });
});

// Actually join tracker
app.post('/join', async (req, res) => {
  const { trackerId, name, number } = req.body;
  const tracker = await Tracker.findOne({ trackerId });

  if (!tracker) return res.send('Invalid Tracker ID');

  const exists = await Member.findOne({ trackerId, number });
  if (!exists) {
    await Member.create({ trackerId, name, number, permission: 'read' });
  }

  let user = await User.findOne({ number });
  if (user) {
    user.name = name;
    if (!user.trackers.includes(trackerId)) {
      user.trackers.push(trackerId);
    }
    await user.save();
  } else {
    await User.create({ number, name, trackers: [trackerId] });
  }

  res.redirect(`/dashboard/${trackerId}?user=${number}`);
});

// Dashboard
app.get('/dashboard/:id', async (req, res) => {
  const { id } = req.params;
  const { user } = req.query;

  const tracker = await Tracker.findOne({ trackerId: id });
  if (!tracker) return res.status(404).send('Tracker not found');
  const members = await Member.find({ trackerId: id });

  const currentUser = members.find((m) => m.number === user);
  if (!currentUser) return res.status(403).send('User not a member of this group');

  const totalAmount = members.reduce((sum, m) => sum + m.amount, 0);
  const perHead = members.length ? totalAmount / members.length : 0;

  const data = members.map((m) => ({
    _id: m._id,
    name: m.name,
    number: m.number,
    permission: m.permission,
    amount: m.amount,
    owes: m.amount - perHead,
  }));

  res.render('dashboard', {
    tracker,
    currentUser,
    members: data,
  });
});

// Helper to ensure array for save-all post
function ensureArray(val) {
  if (Array.isArray(val)) return val;
  if (val === undefined) return [];
  return [val];
}

// Bulk save all member amounts and permissions
app.post('/dashboard/:id/save-all', async (req, res) => {
  const { id } = req.params;
  let { user, target, amount, permission } = req.body;
  target = ensureArray(target);
  amount = ensureArray(amount);
  permission = ensureArray(permission);

  if (!Array.isArray(target) || !Array.isArray(amount) || !Array.isArray(permission) || target.length !== amount.length || target.length !== permission.length) {
    return res.status(400).send('Invalid data');
  }
  const currentUser = await Member.findOne({ trackerId: id, number: user });
  if (!currentUser || (currentUser.permission !== 'leader' && currentUser.permission !== 'write')) {
    return res.status(403).send('No permission');
  }
  for (let i = 0; i < target.length; i++) {
    // Do not allow changing permission for leader
    if (permission[i] === 'leader' && currentUser.permission !== 'leader') continue;
    await Member.findByIdAndUpdate(target[i], { amount: Number(amount[i]), permission: permission[i] });
  }
  res.redirect(`/dashboard/${id}?user=${user}`);
});

// --- HISTORY (MY GROUPS) ---
app.get('/history', (req, res) => {
  res.render('history', { trackers: null, number: '' });
});

app.post('/history', async (req, res) => {
  const { number } = req.body;
  const user = await User.findOne({ number });
  let trackers = [];
  if (user && user.trackers.length > 0) {
    trackers = await Tracker.find({ trackerId: { $in: user.trackers } });
  }
  res.render('history', { trackers, number });
});

// Start
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));