# VEDA — Healthcare Management System 🏥

A full-stack Hospital/Healthcare Management System with role-based access control, patient management, and automated report generation.

## Tech Stack
- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js + Express
- **Database**: MySQL
- **Authentication**: JWT (JSON Web Tokens)
- **Reports**: Python (python-docx)

## Features
- 🔐 Role-based access control (Admin, Doctor, Staff, etc.)
- 🧑‍⚕️ Patient management & records
- 🔑 Secure JWT Authentication
- 🗄️ MySQL database integration

## Project Structure

```
VEDA/
├── VEDA_HMS.html       # Main frontend application
├── VEDA_server.js      # Backend Express server
├── VEDA_schema.sql     # Database schema (run this to set up DB)
├── package.json        # Node.js dependencies
├── .env.example        # Environment variables template
└── README.md           # This file
```

## Setup Instructions

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [MySQL](https://www.mysql.com/) installed and running

---

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/VEDA.git
cd VEDA
```

### 2. Install Node.js dependencies
```bash
npm install
```

### 3. Set up environment variables
Copy the example file and fill in your own values:
```bash
# On Windows (Command Prompt):
copy .env.example .env

# On Mac/Linux:
cp .env.example .env
```
Then open `.env` and fill in your own database credentials.

### 4. Set up the database
Make sure MySQL is running, then import the schema:
```bash
mysql -u root -p < VEDA_schema.sql
```

### 5. Run the server
```bash
node VEDA_server.js
```

### 6. Open the application
Open `VEDA_HMS.html` in your browser or navigate to:
```
http://localhost:3000
```

## ⚠️ Important Security Note

**Never share or upload your `.env` file.** It contains sensitive credentials.
Use `.env.example` as a template and create your own `.env` with real values.

---

## License

This project is for educational/portfolio purposes.
