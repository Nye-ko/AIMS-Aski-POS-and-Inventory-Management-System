# 🚀 AIMS POS & Inventory System

Welcome to the AIMS POS & Inventory Management System repository. Follow the instructions below to clone, configure, and run the project locally on your machine.

---

## 📋 Prerequisites

Ensure you have the following installed before proceeding:
* Node.js (v18 or higher)
* Git
* PostgreSQL installed and running locally

---

## ⚙️ Getting Started

### 1. Clone the Repository
Open your terminal or command prompt and run:

git clone <YOUR-GITHUB-REPO-URL>
cd aims-pos-inventory

---

### 2. Set Up Your Local PostgreSQL Database
Ensure your PostgreSQL service is active, then create the database specified in the project configuration:

* Database Name: aims-pos-ims-db
* Default Database User: postgres
* Default Database Password: admin123

Note: If your local PostgreSQL password is different from admin123, update the password in your local backend/.env file.

To create the database via psql terminal:
CREATE DATABASE "aims-pos-ims-db";

---

### 3. Backend Setup & Startup

1. Navigate to the backend directory:
   cd backend

2. Install all backend dependencies:
   npm install

3. Push the Prisma schema to generate client models and create database tables automatically:
   npx prisma db push

4. Start the backend development server:
   npm run dev

---

### 4. Frontend Setup & Startup

1. Open a new terminal window or tab.

2. Navigate to the frontend directory:
   cd frontend

3. Install frontend dependencies:
   npm install

4. Start the React development server:
   npm run dev

---

## 🌐 Application Endpoints

Once both servers are running:
* Backend API: Available at http://localhost:5000
* Frontend App: Available at http://localhost:5173

---

## 📧 Email Alerts (SMTP)

The backend can email low-stock and expiry alerts. Copy `backend/.env.example`
to `backend/.env` and fill in an SMTP account.

For Gmail:
1. Enable 2-Step Verification at https://myaccount.google.com/security.
2. Generate an App Password at https://myaccount.google.com/apppasswords and
   paste the 16 characters (no spaces) into `SMTP_PASS`.
3. Set `ALERT_RECIPIENTS` to a comma-separated list.
4. Restart the backend. On boot you should see:

   ```
   [mailer] SMTP ready via smtp.gmail.com:587 → …
   [digest] low-stock + expiry scheduled with cron "0 8 * * *" (tz=Asia/Manila)
   ```

Three trigger paths fire:

| When | What |
|---|---|
| A checkout drops any item **to or below** its `minStock` | One email per crossing event |
| A product's expiry date enters `EXPIRY_WARN_DAYS` (default 30) via `PATCH /api/products/:id` | One email per crossing event |
| Daily at `DAILY_DIGEST_CRON` (default 08:00 Asia/Manila) | Two digest emails — every currently-low product and every currently-expiring product |

**Manual dispatch** (useful for wiring buttons into the admin UI):

* `POST /api/alerts/low-stock/send-now` – emails the current low-stock list
* `POST /api/alerts/expiry/send-now` – emails the current expiry list
* `GET /api/alerts/low-stock` – JSON list, no email
* `GET /api/alerts/expiry` – JSON list, no email

If SMTP verification fails on startup, every email path stays OFF and the log
tells you to fix `SMTP_PASS` — no silent retry storms.
