-- ================================================================
-- VEDA HMS — Intelligent Healthcare System
-- Database Schema | MySQL 8.x Compatible
-- Version: 2.0
-- ================================================================

DROP DATABASE IF EXISTS veda_hms;
CREATE DATABASE veda_hms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE veda_hms;

-- ================================================================
-- TABLE 1: DEPARTMENTS
-- ================================================================
CREATE TABLE departments (
    dept_id        INT          NOT NULL AUTO_INCREMENT,
    name           VARCHAR(100) NOT NULL UNIQUE,
    description    TEXT,
    floor          TINYINT      NOT NULL DEFAULT 1,
    phone          VARCHAR(15),
    head_doctor_id INT          DEFAULT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_departments PRIMARY KEY (dept_id)
);

-- ================================================================
-- TABLE 2: DOCTORS
-- ================================================================
CREATE TABLE doctors (
    doctor_id        INT           NOT NULL AUTO_INCREMENT,
    doctor_code      VARCHAR(10)   NOT NULL UNIQUE,
    full_name        VARCHAR(150)  NOT NULL,
    specialisation   VARCHAR(100)  NOT NULL,
    qualification    VARCHAR(200),
    experience_years TINYINT UNSIGNED DEFAULT 0,
    phone            VARCHAR(15)   NOT NULL UNIQUE,
    email            VARCHAR(150)  UNIQUE,
    dept_id          INT           NOT NULL,
    available        ENUM('Yes','No','On Leave') NOT NULL DEFAULT 'Yes',
    created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_doctors  PRIMARY KEY (doctor_id),
    CONSTRAINT fk_doc_dept FOREIGN KEY (dept_id)
        REFERENCES departments(dept_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_doc_dept (dept_id),
    INDEX idx_doc_avail (available)
);

-- Now add the head_doctor FK (circular reference, added after doctors table exists)
ALTER TABLE departments
    ADD CONSTRAINT fk_dept_head
    FOREIGN KEY (head_doctor_id)
    REFERENCES doctors(doctor_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- ================================================================
-- TABLE 3: PATIENTS
-- ================================================================
CREATE TABLE patients (
    patient_id        INT          NOT NULL AUTO_INCREMENT,
    patient_code      VARCHAR(10)  NOT NULL UNIQUE,
    full_name         VARCHAR(150) NOT NULL,
    dob               DATE         NOT NULL,
    gender            ENUM('Male','Female','Other') NOT NULL,
    blood_type        ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown')
                      NOT NULL DEFAULT 'Unknown',
    phone             VARCHAR(15)  NOT NULL UNIQUE,
    email             VARCHAR(150),
    address           TEXT,
    emergency_contact VARCHAR(15),
    registered_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT pk_patients PRIMARY KEY (patient_id),
    INDEX idx_pat_phone  (phone),
    INDEX idx_pat_blood  (blood_type),
    INDEX idx_pat_active (is_active)
);

-- ================================================================
-- TABLE 4: STAFF / ADMIN / DOCTOR LOGIN ACCOUNTS
-- ================================================================
CREATE TABLE users (
    user_id       INT          NOT NULL AUTO_INCREMENT,
    username      VARCHAR(60)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('Admin','Doctor','Receptionist','Nurse','Pharmacist','Lab Technician')
                  NOT NULL,
    linked_id     INT          DEFAULT NULL,   -- doctor_id or staff_id
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login    TIMESTAMP    NULL DEFAULT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_users PRIMARY KEY (user_id)
);

-- ================================================================
-- TABLE 5: PATIENT LOGIN ACCOUNTS (separate from staff users)
-- ================================================================
CREATE TABLE patient_users (
    pu_id         INT          NOT NULL AUTO_INCREMENT,
    patient_id    INT          NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login    TIMESTAMP    NULL DEFAULT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_patient_users PRIMARY KEY (pu_id),
    CONSTRAINT fk_pu_patient    FOREIGN KEY (patient_id)
        REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- ================================================================
-- TABLE 6: AUDIT LOGS
-- ================================================================
CREATE TABLE audit_logs (
    log_id     INT          NOT NULL AUTO_INCREMENT,
    user_id    INT,
    user_type  ENUM('staff','patient') NOT NULL DEFAULT 'staff',
    action     VARCHAR(100) NOT NULL,
    table_name VARCHAR(60),
    record_id  INT,
    details    TEXT,
    ip_address VARCHAR(45),
    logged_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_audit PRIMARY KEY (log_id),
    INDEX idx_audit_user (user_id, user_type),
    INDEX idx_audit_time (logged_at)
);

-- ================================================================
-- TABLE 7: STAFF (Non-doctor employees)
-- ================================================================
CREATE TABLE staff (
    staff_id   INT           NOT NULL AUTO_INCREMENT,
    staff_code VARCHAR(10)   NOT NULL UNIQUE,
    full_name  VARCHAR(150)  NOT NULL,
    role       ENUM('Nurse','Receptionist','Pharmacist','Lab Technician','Administrator','Other')
               NOT NULL,
    dept_id    INT           DEFAULT NULL,
    phone      VARCHAR(15)   NOT NULL UNIQUE,
    email      VARCHAR(150),
    shift      ENUM('Morning','Evening','Night') NOT NULL DEFAULT 'Morning',
    salary     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    joined_at  DATE          NOT NULL,
    is_active  BOOLEAN       NOT NULL DEFAULT TRUE,
    CONSTRAINT pk_staff      PRIMARY KEY (staff_id),
    CONSTRAINT fk_staff_dept FOREIGN KEY (dept_id)
        REFERENCES departments(dept_id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- ================================================================
-- TABLE 8: APPOINTMENTS
-- ================================================================
CREATE TABLE appointments (
    appt_id      INT       NOT NULL AUTO_INCREMENT,
    patient_id   INT       NOT NULL,
    doctor_id    INT       NOT NULL,
    scheduled_at DATETIME  NOT NULL,
    appt_type    ENUM('Consultation','Follow-up','Emergency')
                 NOT NULL DEFAULT 'Consultation',
    status       ENUM('Scheduled','Confirmed','Completed','Cancelled','No Show')
                 NOT NULL DEFAULT 'Scheduled',
    notes        TEXT,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_appointments  PRIMARY KEY (appt_id),
    CONSTRAINT fk_appt_patient  FOREIGN KEY (patient_id)
        REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_appt_doctor   FOREIGN KEY (doctor_id)
        REFERENCES doctors(doctor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    -- Prevent double-booking the same doctor at the same slot
    UNIQUE INDEX uq_doctor_slot (doctor_id, scheduled_at),
    INDEX idx_appt_patient (patient_id),
    INDEX idx_appt_date    (scheduled_at)
);

-- ================================================================
-- TABLE 9: MEDICAL RECORDS
-- ================================================================
CREATE TABLE medical_records (
    record_id   INT       NOT NULL AUTO_INCREMENT,
    patient_id  INT       NOT NULL,
    doctor_id   INT       NOT NULL,
    appt_id     INT       DEFAULT NULL,
    diagnosis   TEXT      NOT NULL,
    notes       TEXT,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_records        PRIMARY KEY (record_id),
    CONSTRAINT fk_rec_patient    FOREIGN KEY (patient_id)
        REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_rec_doctor     FOREIGN KEY (doctor_id)
        REFERENCES doctors(doctor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_rec_appt       FOREIGN KEY (appt_id)
        REFERENCES appointments(appt_id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_rec_patient (patient_id),
    INDEX idx_rec_doctor  (doctor_id)
);

-- ================================================================
-- TABLE 10: WARDS
-- ================================================================
CREATE TABLE wards (
    ward_id   INT          NOT NULL AUTO_INCREMENT,
    name      VARCHAR(100) NOT NULL UNIQUE,
    ward_type ENUM('General','ICU','Emergency','Maternity',
                   'Paediatric','Surgical','Orthopaedic','Oncology') NOT NULL,
    capacity  SMALLINT     NOT NULL DEFAULT 10,
    floor     TINYINT      NOT NULL DEFAULT 1,
    dept_id   INT          DEFAULT NULL,
    CONSTRAINT pk_wards     PRIMARY KEY (ward_id),
    CONSTRAINT fk_ward_dept FOREIGN KEY (dept_id)
        REFERENCES departments(dept_id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- ================================================================
-- TABLE 11: BEDS
-- ================================================================
CREATE TABLE beds (
    bed_id     INT         NOT NULL AUTO_INCREMENT,
    ward_id    INT         NOT NULL,
    bed_number VARCHAR(10) NOT NULL,
    status     ENUM('Available','Occupied','Maintenance') NOT NULL DEFAULT 'Available',
    CONSTRAINT pk_beds        PRIMARY KEY (bed_id),
    CONSTRAINT fk_bed_ward    FOREIGN KEY (ward_id)
        REFERENCES wards(ward_id) ON UPDATE CASCADE ON DELETE CASCADE,
    UNIQUE INDEX uq_bed (ward_id, bed_number)
);

-- ================================================================
-- TABLE 12: ADMISSIONS
-- ================================================================
CREATE TABLE admissions (
    admission_id  INT       NOT NULL AUTO_INCREMENT,
    patient_id    INT       NOT NULL,
    bed_id        INT       NOT NULL,
    doctor_id     INT       NOT NULL,
    reason        TEXT,
    admitted_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    discharged_at TIMESTAMP NULL DEFAULT NULL,
    status        ENUM('Active','Discharged') NOT NULL DEFAULT 'Active',
    CONSTRAINT pk_admissions  PRIMARY KEY (admission_id),
    CONSTRAINT fk_adm_patient FOREIGN KEY (patient_id)
        REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_adm_bed     FOREIGN KEY (bed_id)
        REFERENCES beds(bed_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_adm_doctor  FOREIGN KEY (doctor_id)
        REFERENCES doctors(doctor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_adm_patient (patient_id),
    INDEX idx_adm_status  (status)
);

-- ================================================================
-- TABLE 13: BILLS
-- ================================================================
CREATE TABLE bills (
    bill_id      INT           NOT NULL AUTO_INCREMENT,
    patient_id   INT           NOT NULL,
    admission_id INT           DEFAULT NULL,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    paid_amount  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status       ENUM('Pending','Partially Paid','Paid') NOT NULL DEFAULT 'Pending',
    generated_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_bills        PRIMARY KEY (bill_id),
    CONSTRAINT fk_bill_patient FOREIGN KEY (patient_id)
        REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_bill_adm     FOREIGN KEY (admission_id)
        REFERENCES admissions(admission_id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_bill_patient (patient_id),
    INDEX idx_bill_status  (status)
);

-- ================================================================
-- TABLE 14: BILL LINE ITEMS
-- ================================================================
CREATE TABLE bill_items (
    item_id     INT           NOT NULL AUTO_INCREMENT,
    bill_id     INT           NOT NULL,
    description VARCHAR(200)  NOT NULL,
    quantity    SMALLINT      NOT NULL DEFAULT 1,
    unit_price  DECIMAL(10,2) NOT NULL,
    CONSTRAINT pk_bill_items PRIMARY KEY (item_id),
    CONSTRAINT fk_item_bill  FOREIGN KEY (bill_id)
        REFERENCES bills(bill_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- ================================================================
-- TABLE 15: MEDICINES
-- ================================================================
CREATE TABLE medicines (
    medicine_id   INT           NOT NULL AUTO_INCREMENT,
    name          VARCHAR(150)  NOT NULL UNIQUE,
    category      VARCHAR(80)   NOT NULL,
    unit          VARCHAR(30)   NOT NULL DEFAULT 'Tablet',
    stock_qty     INT           NOT NULL DEFAULT 0,
    reorder_level INT           NOT NULL DEFAULT 10,
    price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    CONSTRAINT pk_medicines PRIMARY KEY (medicine_id),
    INDEX idx_med_cat (category)
);

-- ================================================================
-- TABLE 16: PRESCRIPTIONS
-- ================================================================
CREATE TABLE prescriptions (
    prescription_id INT          NOT NULL AUTO_INCREMENT,
    record_id       INT          NOT NULL,
    medicine_id     INT          NOT NULL,
    dosage          VARCHAR(100) NOT NULL,
    duration_days   TINYINT      NOT NULL DEFAULT 1,
    quantity        SMALLINT     NOT NULL DEFAULT 1,
    CONSTRAINT pk_prescriptions  PRIMARY KEY (prescription_id),
    CONSTRAINT fk_presc_record   FOREIGN KEY (record_id)
        REFERENCES medical_records(record_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_presc_medicine FOREIGN KEY (medicine_id)
        REFERENCES medicines(medicine_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ================================================================
-- TABLE 17: LAB TESTS CATALOGUE
-- ================================================================
CREATE TABLE lab_tests (
    test_id      INT           NOT NULL AUTO_INCREMENT,
    name         VARCHAR(150)  NOT NULL UNIQUE,
    description  TEXT,
    price        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    normal_range VARCHAR(150),
    CONSTRAINT pk_lab_tests PRIMARY KEY (test_id)
);

-- ================================================================
-- TABLE 18: LAB ORDERS
-- ================================================================
CREATE TABLE lab_orders (
    order_id    INT       NOT NULL AUTO_INCREMENT,
    patient_id  INT       NOT NULL,
    doctor_id   INT       NOT NULL,
    test_id     INT       NOT NULL,
    ordered_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status      ENUM('Pending','In Progress','Completed','Cancelled')
                NOT NULL DEFAULT 'Pending',
    result      TEXT,
    result_date TIMESTAMP NULL DEFAULT NULL,
    CONSTRAINT pk_lab_orders  PRIMARY KEY (order_id),
    CONSTRAINT fk_lab_patient FOREIGN KEY (patient_id)
        REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lab_doctor  FOREIGN KEY (doctor_id)
        REFERENCES doctors(doctor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lab_test    FOREIGN KEY (test_id)
        REFERENCES lab_tests(test_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_lab_patient (patient_id),
    INDEX idx_lab_doctor  (doctor_id),
    INDEX idx_lab_status  (status)
);

-- ================================================================
-- VIEWS
-- ================================================================

-- Live bed occupancy per ward
CREATE VIEW vw_bed_availability AS
SELECT
    w.ward_id,
    w.name         AS ward_name,
    w.ward_type,
    w.capacity,
    SUM(b.status = 'Available')   AS available_beds,
    SUM(b.status = 'Occupied')    AS occupied_beds,
    SUM(b.status = 'Maintenance') AS maintenance_beds
FROM wards w
LEFT JOIN beds b ON w.ward_id = b.ward_id
GROUP BY w.ward_id, w.name, w.ward_type, w.capacity;

-- Today's appointments with patient and doctor names
CREATE VIEW vw_today_appointments AS
SELECT
    a.appt_id,
    p.patient_code,
    p.full_name    AS patient_name,
    d.full_name    AS doctor_name,
    d.specialisation,
    a.scheduled_at,
    a.appt_type,
    a.status,
    a.notes
FROM appointments a
JOIN patients p ON a.patient_id = p.patient_id
JOIN doctors  d ON a.doctor_id  = d.doctor_id
WHERE DATE(a.scheduled_at) = CURDATE()
ORDER BY a.scheduled_at;

-- Medicines below reorder level
CREATE VIEW vw_low_stock AS
SELECT
    medicine_id, name, category, unit, stock_qty, reorder_level,
    (reorder_level - stock_qty) AS deficit
FROM medicines
WHERE stock_qty <= reorder_level
ORDER BY deficit DESC;

-- ================================================================
-- SAMPLE DATA
-- ================================================================

INSERT INTO departments (name, description, floor, phone) VALUES
('Cardiology',       'Heart & cardiovascular care',       2, '080-1001'),
('Orthopaedics',     'Bone, joint & muscle treatment',    3, '080-1002'),
('Paediatrics',      'Medical care for children',         1, '080-1003'),
('General Medicine', 'Primary & general healthcare',      1, '080-1004'),
('Neurology',        'Brain & nervous system disorders',  4, '080-1005');

INSERT INTO doctors (doctor_code, full_name, specialisation, qualification, experience_years, phone, email, dept_id, available) VALUES
('D-00001', 'Dr. Anika Sharma',  'Cardiologist',        'MBBS, MD (Cardiology)', 12, '9876500001', 'anika.sharma@veda.in',  1, 'Yes'),
('D-00002', 'Dr. Rohan Mehta',   'Orthopaedic Surgeon', 'MBBS, MS (Ortho)',       8, '9876500002', 'rohan.mehta@veda.in',   2, 'Yes'),
('D-00003', 'Dr. Priya Nair',    'Paediatrician',       'MBBS, DCH',             10, '9876500003', 'priya.nair@veda.in',    3, 'Yes'),
('D-00004', 'Dr. Suresh Kumar',  'General Physician',   'MBBS, PGDM',             6, '9876500004', 'suresh.kumar@veda.in',  4, 'Yes'),
('D-00005', 'Dr. Divya Iyer',    'Neurologist',         'MBBS, DM (Neurology)',  15, '9876500005', 'divya.iyer@veda.in',    5, 'Yes');

UPDATE departments SET head_doctor_id = 1 WHERE dept_id = 1;
UPDATE departments SET head_doctor_id = 2 WHERE dept_id = 2;
UPDATE departments SET head_doctor_id = 3 WHERE dept_id = 3;
UPDATE departments SET head_doctor_id = 4 WHERE dept_id = 4;
UPDATE departments SET head_doctor_id = 5 WHERE dept_id = 5;

INSERT INTO patients (patient_code, full_name, dob, gender, blood_type, phone, email, address, emergency_contact) VALUES
('P-00001', 'Ramesh Verma',   '1978-04-12', 'Male',   'B+',  '9700000001', 'ramesh.v@mail.com',  '12 MG Road, Bengaluru',     '9700000010'),
('P-00002', 'Sunita Rao',     '1990-08-23', 'Female', 'O+',  '9700000002', 'sunita.r@mail.com',  '34 Koramangala, Bengaluru', '9700000011'),
('P-00003', 'Arjun Patel',    '2010-01-05', 'Male',   'A-',  '9700000003', NULL,                 '56 Indiranagar, Bengaluru', '9700000012'),
('P-00004', 'Kavitha Reddy',  '1965-11-30', 'Female', 'AB+', '9700000004', 'kavitha.r@mail.com', '78 Jayanagar, Bengaluru',   '9700000013'),
('P-00005', 'Mohammed Irfan', '1985-06-17', 'Male',   'O-',  '9700000005', 'irfan.m@mail.com',   '90 Whitefield, Bengaluru',  '9700000014');

-- !! IMPORTANT !!
-- The hash below is a placeholder. You MUST replace it with real bcrypt hashes.
-- Run this in Node.js to generate a hash:
--   const bcrypt = require('bcrypt');
--   console.log(await bcrypt.hash('admin123', 10));
-- Then paste the output below replacing the placeholder hash.
INSERT INTO users (username, password_hash, role, linked_id) VALUES
('admin',         '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH', 'Admin',         NULL),
('dr.anika',      '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH', 'Doctor',        1),
('dr.rohan',      '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH', 'Doctor',        2),
('dr.priya',      '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH', 'Doctor',        3),
('dr.suresh',     '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH', 'Doctor',        4),
('dr.divya',      '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH', 'Doctor',        5),
('receptionist1', '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH', 'Receptionist',  NULL);

INSERT INTO patient_users (patient_id, password_hash) VALUES
(1, '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH'),
(2, '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH'),
(3, '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH'),
(4, '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH'),
(5, '$2b$10$PLACEHOLDER_REPLACE_WITH_REAL_HASH');

INSERT INTO medicines (name, category, unit, stock_qty, reorder_level, price) VALUES
('Paracetamol 500mg',  'Analgesic',    'Tablet',  500, 50,  2.50),
('Amoxicillin 250mg',  'Antibiotic',   'Capsule', 200, 30,  8.00),
('Atorvastatin 10mg',  'Statin',       'Tablet',  150, 20, 15.00),
('Metformin 500mg',    'Antidiabetic', 'Tablet',  300, 40,  5.50),
('Omeprazole 20mg',    'Antacid',      'Capsule', 180, 25,  6.00),
('Aspirin 75mg',       'Antiplatelet', 'Tablet',   12, 60,  1.50),
('Azithromycin 500mg', 'Antibiotic',   'Tablet',    8, 15, 22.00),
('Ibuprofen 400mg',    'NSAID',        'Tablet',  250, 30,  4.00);

INSERT INTO lab_tests (name, description, price, normal_range) VALUES
('Complete Blood Count (CBC)', 'Full blood panel analysis',              350.00, 'See report'),
('Blood Glucose (Fasting)',    'Fasting blood sugar level',              120.00, '70–100 mg/dL'),
('Lipid Profile',              'Cholesterol and triglycerides panel',    450.00, 'LDL < 100 mg/dL'),
('Liver Function Test (LFT)', 'Liver enzyme and protein levels',         500.00, 'See report'),
('Urine Routine',              'Complete urine analysis',                150.00, 'See report'),
('ECG',                        'Electrocardiogram – cardiac rhythm',     300.00, 'Normal sinus rhythm'),
('X-Ray Chest',                'Chest radiograph for lungs and heart',   600.00, 'Normal'),
('MRI Brain',                  'Magnetic resonance imaging of brain',   3500.00, 'No abnormality detected');

INSERT INTO wards (name, ward_type, capacity, floor, dept_id) VALUES
('Cardiology Ward A', 'General',      20, 2, 1),
('ICU',               'ICU',           8, 2, 1),
('Ortho Ward B',      'Orthopaedic',  16, 3, 2),
('Paediatric Ward',   'Paediatric',   12, 1, 3),
('General Ward C',    'General',      24, 1, 4);

INSERT INTO beds (ward_id, bed_number, status) VALUES
(1,'C-101','Available'),(1,'C-102','Occupied'),(1,'C-103','Available'),
(2,'ICU-1','Occupied'),(2,'ICU-2','Available'),
(3,'O-201','Available'),(3,'O-202','Available'),
(4,'P-101','Available'),(4,'P-102','Available'),
(5,'G-301','Available'),(5,'G-302','Occupied'),(5,'G-303','Available');

INSERT INTO appointments (patient_id, doctor_id, scheduled_at, appt_type, status, notes) VALUES
(1, 1, '2026-05-12 10:00:00', 'Consultation', 'Confirmed', 'Chest pain follow-up'),
(2, 4, '2026-05-12 11:30:00', 'Consultation', 'Scheduled', 'Routine check-up'),
(3, 3, '2026-05-13 09:00:00', 'Follow-up',    'Scheduled', 'Vaccination schedule'),
(4, 5, '2026-05-14 14:00:00', 'Consultation', 'Scheduled', 'Recurring headaches'),
(5, 2, '2026-05-15 16:00:00', 'Consultation', 'Confirmed', 'Knee pain evaluation'),
(1, 1, '2026-05-20 14:00:00', 'Follow-up',    'Scheduled', 'ECG result review');

INSERT INTO medical_records (patient_id, doctor_id, appt_id, diagnosis, notes) VALUES
(1, 1, 1, 'Hypertension Grade 2',    'Amlodipine 5mg prescribed. Low-sodium diet & 30-min daily walk advised.'),
(2, 4, 2, 'Viral URTI',             'Paracetamol 500mg + steam inhalation. Review in 5 days if no improvement.'),
(4, 5, 4, 'Migraine with aura',     'Sumatriptan 50mg for acute attacks. Advised to maintain a trigger diary.');

INSERT INTO bills (patient_id, total_amount, paid_amount, status) VALUES
(1, 4500.00, 4500.00, 'Paid'),
(2, 1200.00,  600.00, 'Partially Paid'),
(3,  800.00,    0.00, 'Pending'),
(4,15000.00,15000.00, 'Paid'),
(5, 3200.00, 1000.00, 'Partially Paid');

INSERT INTO staff (staff_code, full_name, role, dept_id, phone, email, shift, salary, joined_at) VALUES
('S-00001', 'Meera Thomas', 'Nurse',          1,    '9800000001', 'meera@veda.in',  'Morning', 35000, '2022-06-01'),
('S-00002', 'Raj Pillai',   'Receptionist',   4,    '9800000002', 'raj@veda.in',    'Evening', 28000, '2023-01-15'),
('S-00003', 'Ananya Bose',  'Pharmacist',     NULL, '9800000003', 'ananya@veda.in', 'Morning', 42000, '2021-09-10'),
('S-00004', 'Vikram Singh', 'Lab Technician', NULL, '9800000004', 'vikram@veda.in', 'Night',   38000, '2020-03-22');

INSERT INTO lab_orders (patient_id, doctor_id, test_id, status, result) VALUES
(1, 1, 6, 'Completed', 'Normal sinus rhythm'),
(2, 4, 2, 'In Progress', NULL),
(4, 5, 8, 'Pending',     NULL),
(1, 1, 3, 'Completed',   'LDL: 118 mg/dL — borderline high');

-- ================================================================
SELECT 'VEDA HMS database created successfully!' AS Status;
-- ================================================================
