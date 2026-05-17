// ================================================================
// VEDA HMS — Intelligent Healthcare System
// Backend API Server | Node.js + Express + MySQL2 + JWT + bcrypt
// Version: 2.0
// ================================================================
// Setup:
//   npm install express mysql2 bcrypt jsonwebtoken cors dotenv
//   node server.js
// ================================================================

'use strict';

const express = require('express');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const path    = require('path');

require('dotenv').config();

const app        = express();
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'veda_hms_secret_change_in_production';

// ── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));   // serves VEDA_HMS.html

// ── DATABASE POOL ───────────────────────────────────────────
const pool = mysql.createPool({
  host             : process.env.DB_HOST     || 'localhost',
  user             : process.env.DB_USER     || 'root',
  password         : process.env.DB_PASSWORD || '',
  database         : process.env.DB_NAME     || 'veda_hms',
  waitForConnections: true,
  connectionLimit  : 10,
  queueLimit       : 0,
});

// Test DB connection on startup
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅  MySQL connected → veda_hms');
    conn.release();
  } catch (e) {
    console.error('❌  MySQL connection failed:', e.message);
    console.error('    → Check DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in .env');
  }
})();

// ── UTILITIES ───────────────────────────────────────────────
const wrap = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const ok  = (res, data, code = 200) => res.status(code).json(data);
const bad = (res, msg,  code = 400) => res.status(code).json({ error: msg });

/** Generate next padded code: nextCode('patients','patient_code','P') → 'P-00006' */
async function nextCode(table, col, prefix) {
  const [[row]] = await pool.query(
    `SELECT ${col} FROM ${table} ORDER BY ${col} DESC LIMIT 1`
  );
  if (!row) return `${prefix}-00001`;
  const n = parseInt(row[col].split('-')[1]) + 1;
  return `${prefix}-${String(n).padStart(5, '0')}`;
}

/** Write an audit log entry (never throws) */
async function audit(userId, userType, action, tableName, recordId, ip) {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, user_type, action, table_name, record_id, ip_address)
       VALUES (?,?,?,?,?,?)`,
      [userId, userType, action, tableName || null, recordId || null, ip || null]
    );
  } catch (_) {}
}

// ── AUTH MIDDLEWARE ─────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return bad(res, 'Authentication required. Please login.', 401);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    bad(res, 'Session expired or invalid. Please login again.', 401);
  }
}

/** Role guard — usage: role('Admin', 'Doctor') */
function role(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user?.role))
      return bad(res, `Access denied. Required: ${allowed.join(' or ')}`, 403);
    next();
  };
}

// ── SERVE FRONTEND ──────────────────────────────────────────
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'VEDA_HMS.html'))
);

// ================================================================
// AUTH
// ================================================================

/**
 * POST /api/auth/login
 * Body: { username, password, role: 'admin'|'doctor'|'patient' }
 * Returns: { token, user }
 */
app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password, role: loginRole } = req.body;
  if (!username || !password)
    return bad(res, 'Username and password are required.');

  let tokenPayload, user;

  // ── PATIENT LOGIN (patient_code + password) ──
  if (loginRole === 'patient') {
    const [[row]] = await pool.query(
      `SELECT p.*, pu.password_hash
       FROM patients p
       JOIN patient_users pu ON p.patient_id = pu.patient_id
       WHERE p.patient_code = ? AND p.is_active = 1 AND pu.is_active = 1`,
      [username]
    );
    if (!row) return bad(res, 'Patient ID not found or account is inactive.', 401);

    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) return bad(res, 'Incorrect password.', 401);

    await pool.query(
      'UPDATE patient_users SET last_login = NOW() WHERE patient_id = ?',
      [row.patient_id]
    );
    await audit(row.patient_id, 'patient', 'LOGIN', 'patients', row.patient_id, req.ip);

    tokenPayload = { user_id: row.patient_id, username: row.patient_code, role: 'Patient' };
    user = {
      id: row.patient_id, name: row.full_name, role: 'Patient',
      patient_code: row.patient_code, dob: row.dob,
      gender: row.gender, blood_type: row.blood_type,
      phone: row.phone, email: row.email,
      address: row.address, emergency_contact: row.emergency_contact,
    };
  }

  // ── ADMIN / DOCTOR / STAFF LOGIN ──
  else {
    const [[dbUser]] = await pool.query(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );
    if (!dbUser) return bad(res, 'Username not found.', 401);

    const match = await bcrypt.compare(password, dbUser.password_hash);
    if (!match) return bad(res, 'Incorrect password.', 401);

    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE user_id = ?',
      [dbUser.user_id]
    );
    await audit(dbUser.user_id, 'staff', 'LOGIN', 'users', dbUser.user_id, req.ip);

    tokenPayload = {
      user_id  : dbUser.user_id,
      username : dbUser.username,
      role     : dbUser.role,
    };
    user = { id: dbUser.user_id, name: dbUser.username, role: dbUser.role };

    // Attach full doctor profile
    if (dbUser.role === 'Doctor' && dbUser.linked_id) {
      const [[doc]] = await pool.query(
        `SELECT d.*, dep.name AS dept_name
         FROM doctors d JOIN departments dep ON d.dept_id = dep.dept_id
         WHERE d.doctor_id = ?`,
        [dbUser.linked_id]
      );
      if (doc) {
        tokenPayload.doctor_id = doc.doctor_id;
        Object.assign(user, {
          doctor_id: doc.doctor_id, doctor_code: doc.doctor_code,
          name: doc.full_name, specialisation: doc.specialisation,
          dept: doc.dept_name, qualification: doc.qualification,
          experience_years: doc.experience_years, available: doc.available,
          phone: doc.phone, email: doc.email,
        });
      }
    }
  }

  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
  ok(res, { token, user });
}));

/** POST /api/auth/logout — client discards token; server logs the event */
app.post('/api/auth/logout', auth, wrap(async (req, res) => {
  const uType = req.user.role === 'Patient' ? 'patient' : 'staff';
  await audit(req.user.user_id, uType, 'LOGOUT', null, null, req.ip);
  ok(res, { message: 'Logged out successfully.' });
}));

// ================================================================
// ADMIN DASHBOARD
// ================================================================
app.get('/api/dashboard', auth, role('Admin'), wrap(async (req, res) => {
  const [[pts]]   = await pool.query("SELECT COUNT(*) c FROM patients WHERE is_active=1");
  const [[docs]]  = await pool.query("SELECT COUNT(*) c FROM doctors WHERE available!='No'");
  const [[appts]] = await pool.query("SELECT COUNT(*) c FROM appointments WHERE DATE(scheduled_at)=CURDATE()");
  const [[bills]] = await pool.query("SELECT COUNT(*) c, COALESCE(SUM(total_amount-paid_amount),0) due FROM bills WHERE status!='Paid'");
  const [[meds]]  = await pool.query("SELECT COUNT(*) c FROM vw_low_stock");
  const [[labs]]  = await pool.query("SELECT COUNT(*) c FROM lab_orders WHERE status IN ('Pending','In Progress')");
  const [[rev]]   = await pool.query("SELECT COALESCE(SUM(paid_amount),0) total FROM bills WHERE MONTH(generated_at)=MONTH(NOW())");
  const [[beds]]  = await pool.query("SELECT SUM(capacity) total, SUM(occupied_beds) occ FROM vw_bed_availability");

  ok(res, {
    total_patients     : pts.c,
    active_doctors     : docs.c,
    today_appointments : appts.c,
    pending_bills      : bills.c,
    outstanding_amount : Number(bills.due),
    low_stock_items    : meds.c,
    pending_lab_orders : labs.c,
    monthly_revenue    : Number(rev.total),
    bed_occupancy_pct  : beds.total ? Math.round(beds.occ / beds.total * 100) : 0,
  });
}));

// ================================================================
// PATIENTS
// ================================================================
app.get('/api/patients', auth, role('Admin','Doctor','Receptionist'), wrap(async (req, res) => {
  const { q, gender, blood } = req.query;
  let sql = 'SELECT * FROM patients WHERE is_active=1';
  const p = [];
  if (q)      { sql += ' AND (full_name LIKE ? OR patient_code LIKE ? OR phone LIKE ?)'; p.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  if (gender) { sql += ' AND gender=?'; p.push(gender); }
  if (blood)  { sql += ' AND blood_type=?'; p.push(blood); }
  sql += ' ORDER BY registered_at DESC';
  const [rows] = await pool.query(sql, p);
  ok(res, rows);
}));

app.get('/api/patients/:id', auth, wrap(async (req, res) => {
  // Patients may only fetch their own record
  if (req.user.role === 'Patient' && req.user.user_id != req.params.id)
    return bad(res, 'You can only view your own record.', 403);

  const [[patient]] = await pool.query('SELECT * FROM patients WHERE patient_id=?', [req.params.id]);
  if (!patient) return bad(res, 'Patient not found.', 404);

  const [appointments] = await pool.query(
    `SELECT a.*, d.full_name AS doctor_name, d.specialisation
     FROM appointments a JOIN doctors d ON a.doctor_id=d.doctor_id
     WHERE a.patient_id=? ORDER BY a.scheduled_at DESC`, [req.params.id]);

  const [bills]   = await pool.query('SELECT * FROM bills WHERE patient_id=? ORDER BY generated_at DESC', [req.params.id]);
  const [records] = await pool.query(
    `SELECT mr.*, d.full_name AS doctor_name FROM medical_records mr
     JOIN doctors d ON mr.doctor_id=d.doctor_id
     WHERE mr.patient_id=? ORDER BY mr.recorded_at DESC`, [req.params.id]);
  const [labs]    = await pool.query(
    `SELECT lo.*, lt.name AS test_name, d.full_name AS doctor_name
     FROM lab_orders lo JOIN lab_tests lt ON lo.test_id=lt.test_id
     JOIN doctors d ON lo.doctor_id=d.doctor_id
     WHERE lo.patient_id=? ORDER BY lo.ordered_at DESC`, [req.params.id]);

  ok(res, { patient, appointments, bills, records, labs });
}));

app.post('/api/patients', auth, role('Admin','Receptionist'), wrap(async (req, res) => {
  const { full_name, dob, gender, blood_type, phone, email, address, emergency_contact } = req.body;
  if (!full_name || !dob || !gender || !phone)
    return bad(res, 'full_name, dob, gender and phone are required.');

  const patient_code = await nextCode('patients', 'patient_code', 'P');
  const [r] = await pool.query(
    `INSERT INTO patients
       (patient_code, full_name, dob, gender, blood_type, phone, email, address, emergency_contact)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [patient_code, full_name, dob, gender, blood_type||'Unknown', phone,
     email||null, address||null, emergency_contact||null]
  );
  await audit(req.user.user_id, 'staff', 'CREATE_PATIENT', 'patients', r.insertId, req.ip);
  ok(res, { patient_id: r.insertId, patient_code }, 201);
}));

app.put('/api/patients/:id', auth, role('Admin'), wrap(async (req, res) => {
  const { full_name, dob, gender, blood_type, phone, email, address, emergency_contact } = req.body;
  await pool.query(
    `UPDATE patients
     SET full_name=?, dob=?, gender=?, blood_type=?, phone=?,
         email=?, address=?, emergency_contact=?
     WHERE patient_id=?`,
    [full_name, dob, gender, blood_type, phone, email, address, emergency_contact, req.params.id]
  );
  await audit(req.user.user_id, 'staff', 'UPDATE_PATIENT', 'patients', req.params.id, req.ip);
  ok(res, { updated: true });
}));

app.delete('/api/patients/:id', auth, role('Admin'), wrap(async (req, res) => {
  await pool.query('UPDATE patients SET is_active=0 WHERE patient_id=?', [req.params.id]);
  await audit(req.user.user_id, 'staff', 'DELETE_PATIENT', 'patients', req.params.id, req.ip);
  ok(res, { deleted: true });
}));

// ================================================================
// DOCTORS
// ================================================================
app.get('/api/doctors', auth, wrap(async (req, res) => {
  const { q, dept, avail } = req.query;
  let sql = `SELECT d.*, dep.name AS dept_name
             FROM doctors d JOIN departments dep ON d.dept_id=dep.dept_id WHERE 1=1`;
  const p = [];
  if (q)     { sql += ' AND (d.full_name LIKE ? OR d.specialisation LIKE ?)'; p.push(`%${q}%`,`%${q}%`); }
  if (dept)  { sql += ' AND dep.name=?'; p.push(dept); }
  if (avail) { sql += ' AND d.available=?'; p.push(avail); }
  sql += ' ORDER BY d.full_name';
  const [rows] = await pool.query(sql, p);
  ok(res, rows);
}));

app.post('/api/doctors', auth, role('Admin'), wrap(async (req, res) => {
  const { full_name, specialisation, qualification, experience_years, phone, email, dept_id, available } = req.body;
  if (!full_name || !specialisation || !phone || !dept_id)
    return bad(res, 'full_name, specialisation, phone and dept_id are required.');

  const doctor_code = await nextCode('doctors', 'doctor_code', 'D');
  const [r] = await pool.query(
    `INSERT INTO doctors
       (doctor_code, full_name, specialisation, qualification,
        experience_years, phone, email, dept_id, available)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [doctor_code, full_name, specialisation, qualification||null,
     experience_years||0, phone, email||null, dept_id, available||'Yes']
  );
  ok(res, { doctor_id: r.insertId, doctor_code }, 201);
}));

app.put('/api/doctors/:id', auth, role('Admin'), wrap(async (req, res) => {
  const { full_name, specialisation, qualification, experience_years, phone, email, dept_id, available } = req.body;
  await pool.query(
    `UPDATE doctors
     SET full_name=?, specialisation=?, qualification=?, experience_years=?,
         phone=?, email=?, dept_id=?, available=?
     WHERE doctor_id=?`,
    [full_name, specialisation, qualification, experience_years, phone, email, dept_id, available, req.params.id]
  );
  ok(res, { updated: true });
}));

app.delete('/api/doctors/:id', auth, role('Admin'), wrap(async (req, res) => {
  await pool.query('DELETE FROM doctors WHERE doctor_id=?', [req.params.id]);
  ok(res, { deleted: true });
}));

// ================================================================
// DEPARTMENTS
// ================================================================
app.get('/api/departments', auth, wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.*, doc.full_name AS head_name
     FROM departments d LEFT JOIN doctors doc ON d.head_doctor_id=doc.doctor_id
     ORDER BY d.name`
  );
  ok(res, rows);
}));

// ================================================================
// APPOINTMENTS
// ================================================================
app.get('/api/appointments', auth, wrap(async (req, res) => {
  let sql = `SELECT a.*, p.full_name AS patient_name, p.patient_code,
                    d.full_name AS doctor_name, d.specialisation
             FROM appointments a
             JOIN patients p ON a.patient_id=p.patient_id
             JOIN doctors  d ON a.doctor_id =d.doctor_id WHERE 1=1`;
  const p = [];

  if (req.user.role === 'Patient') { sql += ' AND a.patient_id=?'; p.push(req.user.user_id); }
  if (req.user.role === 'Doctor')  { sql += ' AND a.doctor_id=?';  p.push(req.user.doctor_id); }

  const { q, status, date, doctor_id, patient_id } = req.query;
  if (q)          { sql += ' AND (p.full_name LIKE ? OR d.full_name LIKE ?)'; p.push(`%${q}%`,`%${q}%`); }
  if (status)     { sql += ' AND a.status=?';                  p.push(status); }
  if (date)       { sql += ' AND DATE(a.scheduled_at)=?';      p.push(date); }
  if (doctor_id  && req.user.role === 'Admin') { sql += ' AND a.doctor_id=?';  p.push(doctor_id); }
  if (patient_id && req.user.role === 'Admin') { sql += ' AND a.patient_id=?'; p.push(patient_id); }

  sql += ' ORDER BY a.scheduled_at';
  const [rows] = await pool.query(sql, p);
  ok(res, rows);
}));

app.post('/api/appointments', auth, role('Admin','Receptionist','Patient'), wrap(async (req, res) => {
  const { patient_id, doctor_id, scheduled_at, appt_type, notes } = req.body;
  if (!patient_id || !doctor_id || !scheduled_at)
    return bad(res, 'patient_id, doctor_id and scheduled_at are required.');

  if (req.user.role === 'Patient' && req.user.user_id != patient_id)
    return bad(res, 'You can only book appointments for yourself.', 403);

  // Double-booking check
  const [[clash]] = await pool.query(
    `SELECT appt_id FROM appointments
     WHERE doctor_id=? AND scheduled_at=? AND status NOT IN ('Cancelled','No Show')`,
    [doctor_id, scheduled_at]
  );
  if (clash) return bad(res, 'This time slot is already booked for that doctor.', 409);

  const [r] = await pool.query(
    `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, appt_type, notes)
     VALUES (?,?,?,?,?)`,
    [patient_id, doctor_id, scheduled_at, appt_type||'Consultation', notes||null]
  );
  ok(res, { appt_id: r.insertId }, 201);
}));

app.patch('/api/appointments/:id/status', auth, role('Admin','Doctor','Receptionist'), wrap(async (req, res) => {
  const { status } = req.body;
  const valid = ['Scheduled','Confirmed','Completed','Cancelled','No Show'];
  if (!valid.includes(status)) return bad(res, 'Invalid status value.');

  if (req.user.role === 'Doctor') {
    const [[appt]] = await pool.query('SELECT doctor_id FROM appointments WHERE appt_id=?', [req.params.id]);
    if (!appt || appt.doctor_id !== req.user.doctor_id)
      return bad(res, 'You can only update your own appointments.', 403);
  }

  await pool.query('UPDATE appointments SET status=? WHERE appt_id=?', [status, req.params.id]);
  ok(res, { updated: true });
}));

app.patch('/api/appointments/:id/cancel', auth, wrap(async (req, res) => {
  const [[appt]] = await pool.query('SELECT * FROM appointments WHERE appt_id=?', [req.params.id]);
  if (!appt) return bad(res, 'Appointment not found.', 404);

  if (req.user.role === 'Patient' && appt.patient_id !== req.user.user_id)
    return bad(res, 'You can only cancel your own appointments.', 403);
  if (['Completed','Cancelled'].includes(appt.status))
    return bad(res, `Cannot cancel a ${appt.status} appointment.`);

  await pool.query("UPDATE appointments SET status='Cancelled' WHERE appt_id=?", [req.params.id]);
  ok(res, { cancelled: true });
}));

// ================================================================
// MEDICAL RECORDS
// ================================================================
app.get('/api/records', auth, wrap(async (req, res) => {
  let sql = `SELECT mr.*, p.full_name AS patient_name, d.full_name AS doctor_name
             FROM medical_records mr
             JOIN patients p ON mr.patient_id=p.patient_id
             JOIN doctors  d ON mr.doctor_id =d.doctor_id WHERE 1=1`;
  const p = [];
  if (req.user.role === 'Patient') { sql += ' AND mr.patient_id=?'; p.push(req.user.user_id); }
  if (req.user.role === 'Doctor')  { sql += ' AND mr.doctor_id=?';  p.push(req.user.doctor_id); }
  if (req.query.patient_id && req.user.role === 'Admin') { sql += ' AND mr.patient_id=?'; p.push(req.query.patient_id); }
  sql += ' ORDER BY mr.recorded_at DESC';
  const [rows] = await pool.query(sql, p);
  ok(res, rows);
}));

app.post('/api/records', auth, role('Doctor','Admin'), wrap(async (req, res) => {
  const { patient_id, doctor_id, appt_id, diagnosis, notes } = req.body;
  if (!patient_id || !diagnosis) return bad(res, 'patient_id and diagnosis are required.');
  const did = req.user.role === 'Doctor' ? req.user.doctor_id : doctor_id;
  const [r] = await pool.query(
    `INSERT INTO medical_records (patient_id, doctor_id, appt_id, diagnosis, notes)
     VALUES (?,?,?,?,?)`,
    [patient_id, did, appt_id||null, diagnosis, notes||null]
  );
  ok(res, { record_id: r.insertId }, 201);
}));

// ================================================================
// WARDS & BEDS
// ================================================================
app.get('/api/wards', auth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM vw_bed_availability ORDER BY ward_name');
  ok(res, rows);
}));

app.get('/api/beds', auth, wrap(async (req, res) => {
  const { ward_id, status } = req.query;
  let sql = 'SELECT b.*, w.name AS ward_name FROM beds b JOIN wards w ON b.ward_id=w.ward_id WHERE 1=1';
  const p = [];
  if (ward_id) { sql += ' AND b.ward_id=?'; p.push(ward_id); }
  if (status)  { sql += ' AND b.status=?';  p.push(status); }
  sql += ' ORDER BY b.bed_number';
  const [rows] = await pool.query(sql, p);
  ok(res, rows);
}));

app.patch('/api/beds/:id/status', auth, role('Admin','Nurse'), wrap(async (req, res) => {
  const { status } = req.body;
  if (!['Available','Occupied','Maintenance'].includes(status))
    return bad(res, 'status must be Available, Occupied or Maintenance.');
  await pool.query('UPDATE beds SET status=? WHERE bed_id=?', [status, req.params.id]);
  ok(res, { updated: true });
}));

// ================================================================
// ADMISSIONS
// ================================================================
app.get('/api/admissions', auth, role('Admin','Doctor','Nurse'), wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.*, p.full_name AS patient_name, d.full_name AS doctor_name,
            b.bed_number, w.name AS ward_name
     FROM admissions a
     JOIN patients p ON a.patient_id=p.patient_id
     JOIN doctors  d ON a.doctor_id =d.doctor_id
     JOIN beds     b ON a.bed_id    =b.bed_id
     JOIN wards    w ON b.ward_id   =w.ward_id
     ORDER BY a.admitted_at DESC`
  );
  ok(res, rows);
}));

app.post('/api/admissions', auth, role('Admin','Receptionist'), wrap(async (req, res) => {
  const { patient_id, bed_id, doctor_id, reason } = req.body;
  if (!patient_id || !bed_id || !doctor_id)
    return bad(res, 'patient_id, bed_id and doctor_id are required.');

  await pool.query("UPDATE beds SET status='Occupied' WHERE bed_id=?", [bed_id]);
  const [r] = await pool.query(
    'INSERT INTO admissions (patient_id, bed_id, doctor_id, reason) VALUES (?,?,?,?)',
    [patient_id, bed_id, doctor_id, reason||null]
  );
  ok(res, { admission_id: r.insertId }, 201);
}));

app.patch('/api/admissions/:id/discharge', auth, role('Admin','Doctor'), wrap(async (req, res) => {
  const [[adm]] = await pool.query('SELECT * FROM admissions WHERE admission_id=?', [req.params.id]);
  if (!adm) return bad(res, 'Admission not found.', 404);
  if (adm.status === 'Discharged') return bad(res, 'Patient already discharged.');

  await pool.query(
    "UPDATE admissions SET status='Discharged', discharged_at=NOW() WHERE admission_id=?",
    [req.params.id]
  );
  await pool.query("UPDATE beds SET status='Available' WHERE bed_id=?", [adm.bed_id]);
  ok(res, { discharged: true });
}));

// ================================================================
// BILLING
// ================================================================
app.get('/api/bills', auth, wrap(async (req, res) => {
  let sql = `SELECT b.*, p.full_name AS patient_name, p.patient_code
             FROM bills b JOIN patients p ON b.patient_id=p.patient_id WHERE 1=1`;
  const p = [];
  if (req.user.role === 'Patient') { sql += ' AND b.patient_id=?'; p.push(req.user.user_id); }
  const { q, status, patient_id } = req.query;
  if (q)          { sql += ' AND (p.full_name LIKE ? OR b.bill_id LIKE ?)'; p.push(`%${q}%`,`%${q}%`); }
  if (status)     { sql += ' AND b.status=?'; p.push(status); }
  if (patient_id && req.user.role === 'Admin') { sql += ' AND b.patient_id=?'; p.push(patient_id); }
  sql += ' ORDER BY b.generated_at DESC';
  const [rows] = await pool.query(sql, p);
  ok(res, rows);
}));

app.get('/api/bills/:id/items', auth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM bill_items WHERE bill_id=?', [req.params.id]);
  ok(res, rows);
}));

app.post('/api/bills', auth, role('Admin','Receptionist'), wrap(async (req, res) => {
  const { patient_id, admission_id, items, paid_amount } = req.body;
  if (!patient_id || !items?.length)
    return bad(res, 'patient_id and at least one item are required.');

  const total  = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const paid   = paid_amount || 0;
  const status = paid >= total ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Pending';

  const [bill] = await pool.query(
    `INSERT INTO bills (patient_id, admission_id, total_amount, paid_amount, status)
     VALUES (?,?,?,?,?)`,
    [patient_id, admission_id||null, total, paid, status]
  );
  const bill_id = bill.insertId;

  for (const item of items) {
    await pool.query(
      'INSERT INTO bill_items (bill_id, description, quantity, unit_price) VALUES (?,?,?,?)',
      [bill_id, item.description, item.quantity, item.unit_price]
    );
  }
  ok(res, { bill_id, total, status }, 201);
}));

app.patch('/api/bills/:id/pay', auth, wrap(async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return bad(res, 'A valid positive amount is required.');

  const [[bill]] = await pool.query('SELECT * FROM bills WHERE bill_id=?', [req.params.id]);
  if (!bill) return bad(res, 'Bill not found.', 404);

  if (req.user.role === 'Patient' && bill.patient_id !== req.user.user_id)
    return bad(res, 'You can only pay your own bills.', 403);
  if (bill.status === 'Paid') return bad(res, 'This bill is already fully paid.');

  const newPaid = Math.min(Number(bill.paid_amount) + amount, Number(bill.total_amount));
  const status  = newPaid >= bill.total_amount ? 'Paid' : 'Partially Paid';

  await pool.query(
    'UPDATE bills SET paid_amount=?, status=? WHERE bill_id=?',
    [newPaid, status, req.params.id]
  );
  ok(res, { paid_amount: newPaid, status });
}));

// ================================================================
// PHARMACY — MEDICINES
// ================================================================
app.get('/api/medicines', auth, wrap(async (req, res) => {
  const { q, cat, low_stock } = req.query;
  let sql = 'SELECT * FROM medicines WHERE 1=1';
  const p = [];
  if (q)         { sql += ' AND name LIKE ?'; p.push(`%${q}%`); }
  if (cat)       { sql += ' AND category=?'; p.push(cat); }
  if (low_stock) { sql += ' AND stock_qty <= reorder_level'; }
  sql += ' ORDER BY name';
  const [rows] = await pool.query(sql, p);
  ok(res, rows);
}));

app.post('/api/medicines', auth, role('Admin','Pharmacist'), wrap(async (req, res) => {
  const { name, category, unit, stock_qty, reorder_level, price } = req.body;
  if (!name || !category) return bad(res, 'name and category are required.');
  const [r] = await pool.query(
    'INSERT INTO medicines (name, category, unit, stock_qty, reorder_level, price) VALUES (?,?,?,?,?,?)',
    [name, category, unit||'Tablet', stock_qty||0, reorder_level||10, price||0]
  );
  ok(res, { medicine_id: r.insertId }, 201);
}));

app.patch('/api/medicines/:id/stock', auth, role('Admin','Pharmacist'), wrap(async (req, res) => {
  const { action, qty } = req.body;
  if (!['in','out'].includes(action)) return bad(res, "action must be 'in' or 'out'.");
  if (!qty || qty <= 0) return bad(res, 'qty must be a positive number.');

  if (action === 'out') {
    const [[med]] = await pool.query('SELECT stock_qty FROM medicines WHERE medicine_id=?', [req.params.id]);
    if (!med) return bad(res, 'Medicine not found.', 404);
    if (med.stock_qty < qty) return bad(res, `Insufficient stock. Only ${med.stock_qty} units available.`);
  }

  await pool.query(
    `UPDATE medicines SET stock_qty = stock_qty ${action === 'in' ? '+' : '-'} ? WHERE medicine_id=?`,
    [qty, req.params.id]
  );
  ok(res, { updated: true });
}));

// ================================================================
// LABORATORY
// ================================================================
app.get('/api/lab-tests', auth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM lab_tests ORDER BY name');
  ok(res, rows);
}));

app.get('/api/lab-orders', auth, wrap(async (req, res) => {
  let sql = `SELECT lo.*, lt.name AS test_name, lt.price AS test_price,
                    p.full_name AS patient_name, d.full_name AS doctor_name
             FROM lab_orders lo
             JOIN lab_tests lt ON lo.test_id   =lt.test_id
             JOIN patients  p  ON lo.patient_id=p.patient_id
             JOIN doctors   d  ON lo.doctor_id =d.doctor_id WHERE 1=1`;
  const p = [];
  if (req.user.role === 'Patient') { sql += ' AND lo.patient_id=?'; p.push(req.user.user_id); }
  if (req.user.role === 'Doctor')  { sql += ' AND lo.doctor_id=?';  p.push(req.user.doctor_id); }
  if (req.query.status) { sql += ' AND lo.status=?'; p.push(req.query.status); }
  sql += ' ORDER BY lo.ordered_at DESC';
  const [rows] = await pool.query(sql, p);
  ok(res, rows);
}));

app.post('/api/lab-orders', auth, role('Doctor','Admin'), wrap(async (req, res) => {
  const { patient_id, test_id, doctor_id } = req.body;
  if (!patient_id || !test_id) return bad(res, 'patient_id and test_id are required.');
  const did = req.user.role === 'Doctor' ? req.user.doctor_id : doctor_id;
  const [r] = await pool.query(
    'INSERT INTO lab_orders (patient_id, doctor_id, test_id) VALUES (?,?,?)',
    [patient_id, did, test_id]
  );
  ok(res, { order_id: r.insertId }, 201);
}));

app.patch('/api/lab-orders/:id/result', auth, role('Admin','Lab Technician'), wrap(async (req, res) => {
  const { status, result } = req.body;
  const valid = ['Pending','In Progress','Completed','Cancelled'];
  if (!valid.includes(status)) return bad(res, 'Invalid status.');
  await pool.query(
    `UPDATE lab_orders
     SET status=?, result=?, result_date=${status === 'Completed' ? 'NOW()' : 'NULL'}
     WHERE order_id=?`,
    [status, result||null, req.params.id]
  );
  ok(res, { updated: true });
}));

// ================================================================
// DOCTOR PORTAL
// ================================================================
app.get('/api/doctor/dashboard', auth, role('Doctor'), wrap(async (req, res) => {
  const did = req.user.doctor_id;
  const [[todayAppts]]  = await pool.query(
    "SELECT COUNT(*) c FROM appointments WHERE doctor_id=? AND DATE(scheduled_at)=CURDATE()", [did]);
  const [[totalPats]]   = await pool.query(
    "SELECT COUNT(DISTINCT patient_id) c FROM appointments WHERE doctor_id=?", [did]);
  const [[pendingLabs]] = await pool.query(
    "SELECT COUNT(*) c FROM lab_orders WHERE doctor_id=? AND status='Pending'", [did]);
  const [upcoming]      = await pool.query(
    `SELECT a.*, p.full_name AS patient_name
     FROM appointments a JOIN patients p ON a.patient_id=p.patient_id
     WHERE a.doctor_id=? AND a.scheduled_at >= NOW() AND a.status IN ('Scheduled','Confirmed')
     ORDER BY a.scheduled_at LIMIT 5`, [did]);

  ok(res, {
    today_appointments: todayAppts.c,
    total_patients    : totalPats.c,
    pending_labs      : pendingLabs.c,
    upcoming,
  });
}));

// ================================================================
// PATIENT PORTAL
// ================================================================
app.get('/api/patient/dashboard', auth, role('Patient'), wrap(async (req, res) => {
  const pid = req.user.user_id;
  const [[totalAppts]]  = await pool.query("SELECT COUNT(*) c FROM appointments WHERE patient_id=?", [pid]);
  const [[unpaidBills]] = await pool.query("SELECT COUNT(*) c FROM bills WHERE patient_id=? AND status!='Paid'", [pid]);
  const [[labsDone]]    = await pool.query("SELECT COUNT(*) c FROM lab_orders WHERE patient_id=? AND status='Completed'", [pid]);
  const [[nextAppt]]    = await pool.query(
    `SELECT a.*, d.full_name AS doctor_name, d.specialisation
     FROM appointments a JOIN doctors d ON a.doctor_id=d.doctor_id
     WHERE a.patient_id=? AND a.scheduled_at >= NOW() AND a.status IN ('Scheduled','Confirmed')
     ORDER BY a.scheduled_at LIMIT 1`, [pid]);
  const [recentRecords] = await pool.query(
    `SELECT mr.*, d.full_name AS doctor_name FROM medical_records mr
     JOIN doctors d ON mr.doctor_id=d.doctor_id
     WHERE mr.patient_id=? ORDER BY mr.recorded_at DESC LIMIT 3`, [pid]);

  ok(res, {
    total_appointments : totalAppts.c,
    unpaid_bills       : unpaidBills.c,
    lab_results_ready  : labsDone.c,
    next_appointment   : nextAppt || null,
    recent_records     : recentRecords,
  });
}));

// ================================================================
// STAFF
// ================================================================
app.get('/api/staff', auth, role('Admin'), wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.*, d.name AS dept_name
     FROM staff s LEFT JOIN departments d ON s.dept_id=d.dept_id
     WHERE s.is_active=1 ORDER BY s.full_name`
  );
  ok(res, rows);
}));

app.post('/api/staff', auth, role('Admin'), wrap(async (req, res) => {
  const { full_name, role: sRole, dept_id, phone, email, shift, salary, joined_at } = req.body;
  if (!full_name || !sRole || !phone || !joined_at)
    return bad(res, 'full_name, role, phone and joined_at are required.');

  const staff_code = await nextCode('staff', 'staff_code', 'S');
  const [r] = await pool.query(
    `INSERT INTO staff
       (staff_code, full_name, role, dept_id, phone, email, shift, salary, joined_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [staff_code, full_name, sRole, dept_id||null, phone, email||null, shift||'Morning', salary||0, joined_at]
  );
  ok(res, { staff_id: r.insertId, staff_code }, 201);
}));

// ================================================================
// GLOBAL SEARCH
// ================================================================
app.get('/api/search', auth, role('Admin'), wrap(async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return ok(res, { patients: [], doctors: [], appointments: [] });

  const [patients] = await pool.query(
    `SELECT patient_id, patient_code, full_name, phone, blood_type
     FROM patients WHERE is_active=1
     AND (full_name LIKE ? OR patient_code LIKE ? OR phone LIKE ?) LIMIT 5`,
    [`%${q}%`,`%${q}%`,`%${q}%`]
  );
  const [doctors] = await pool.query(
    `SELECT doctor_id, doctor_code, full_name, specialisation
     FROM doctors WHERE full_name LIKE ? OR specialisation LIKE ? LIMIT 5`,
    [`%${q}%`,`%${q}%`]
  );
  const [appointments] = await pool.query(
    `SELECT a.appt_id, p.full_name AS patient, d.full_name AS doctor,
            a.scheduled_at, a.status
     FROM appointments a
     JOIN patients p ON a.patient_id=p.patient_id
     JOIN doctors  d ON a.doctor_id =d.doctor_id
     WHERE p.full_name LIKE ? OR d.full_name LIKE ?
     ORDER BY a.scheduled_at DESC LIMIT 5`,
    [`%${q}%`,`%${q}%`]
  );
  ok(res, { patients, doctors, appointments });
}));

// ================================================================
// REPORTS
// ================================================================
app.get('/api/reports/monthly-revenue', auth, role('Admin'), wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(generated_at,'%Y-%m') AS month,
            SUM(total_amount) AS billed,
            SUM(paid_amount)  AS collected
     FROM bills
     GROUP BY DATE_FORMAT(generated_at,'%Y-%m')
     ORDER BY month DESC LIMIT 12`
  );
  ok(res, rows);
}));

app.get('/api/reports/today', auth, role('Admin'), wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM vw_today_appointments');
  ok(res, rows);
}));

app.get('/api/reports/low-stock', auth, role('Admin','Pharmacist'), wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM vw_low_stock');
  ok(res, rows);
}));

app.get('/api/reports/department-stats', auth, role('Admin'), wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT dep.name, COUNT(DISTINCT d.doctor_id) AS doctors,
            COUNT(DISTINCT a.appt_id) AS appointments
     FROM departments dep
     LEFT JOIN doctors      d ON dep.dept_id=d.dept_id
     LEFT JOIN appointments a ON d.doctor_id=a.doctor_id
     GROUP BY dep.dept_id, dep.name ORDER BY dep.name`
  );
  ok(res, rows);
}));

// ================================================================
// ERROR HANDLER
// ================================================================
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error.', detail: err.message });
});

// ================================================================
// START
// ================================================================
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║         VEDA HMS — Server Started         ║
╠═══════════════════════════════════════════╣
║  Frontend  →  http://localhost:${PORT}        ║
║  API Base  →  http://localhost:${PORT}/api    ║
║  Database  →  veda_hms @ MySQL            ║
╚═══════════════════════════════════════════╝
  `);
});
