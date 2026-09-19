# 🌱 Organic Farming System

A modern, farmer-friendly agriculture platform built for practical farm planning, crop guidance, weather insights, soil screening, disease awareness, marketplace orders and farmer activity tracking.

## 🚀 Live Demo

**Production:** https://organic-farming-system.onrender.com

**Repository:** https://github.com/niitin001/organic-farming-system

## ✨ Features

### 🌾 Smart Farming
- Smart crop recommendations using season, soil and water inputs
- Crop detail pages with growing profiles and planning checklists
- Soil health screening with pH and N/P/K guidance
- Disease & pest awareness guides
- Farm activity planner with task progress
- Irrigation planning calculator
- Farming cost and profit calculator
- Live weather with forecast and farming advice

### 🛒 Farmer Marketplace
- Product catalogue with categories and search
- Cart and checkout flow
- Server-side product pricing
- Stock-aware order creation
- Order history and tracking status
- Demo checkout flow — no real payment is processed

### 👨‍🌾 Farmer Dashboard
- JWT-based account authentication
- Saved/favourite crops
- Recent orders
- Farm tasks and progress
- Quick access to farming tools
- English/Hindi UI foundation

### 🛡️ Admin Dashboard
- Admin-only access control
- User statistics
- User management view
- Product management
- Order status management
- Farmer contact/message management
- Inventory-safe order cancellation

## 🏗️ Production Architecture

```
Browser
   │
   ▼
Express + Node.js
   │
   ├── JWT Authentication
   ├── Farming APIs
   ├── Marketplace APIs
   ├── Admin APIs
   └── Weather API proxy
   │
   ▼
PostgreSQL
   ├── users
   ├── crops
   ├── products
   ├── orders
   ├── order_items
   ├── contacts
   ├── saved_crops
   └── farm_tasks
```

## 🧰 Tech Stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Authentication:** JWT + bcryptjs
- **Weather:** OpenWeather API through the server
- **Deployment:** Render Web Service + PostgreSQL
- **Version Control:** GitHub

## 🔐 Security

- Passwords are hashed with bcrypt.
- Authentication uses JWT tokens.
- Database credentials stay in environment variables.
- Weather API credentials remain server-side.
- Sensitive server/config files are blocked from static access.
- Admin APIs verify the user's database role.
- Payment is explicitly demo-only until a real gateway is integrated.

## 💻 Run Locally

1. Clone the repository.
2. Create a PostgreSQL database.
3. Copy `.env.example` to `.env`.
4. Configure:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `WEATHER_API_KEY`
   - optional `ADMIN_EMAIL`
5. Install dependencies:

```bash
npm install
```

6. Start the application:

```bash
npm start
```

7. Open `http://localhost:3000`.

## ☁️ Render Deployment

The repository includes `render.yaml` for a Node.js web service and PostgreSQL database.

The deployment branch is:

```
deployment-ready
```

Set `WEATHER_API_KEY` and `ADMIN_EMAIL` as Render environment variables. The database connection is supplied by the Render PostgreSQL service.

## ⚠️ Product Notes

- Weather information depends on the configured weather API and should be treated as planning guidance.
- Soil and irrigation outputs are screening/planning estimates, not laboratory or agronomy diagnoses.
- Disease pages provide awareness guidance and do not confirm a plant disease.
- Farm costs and expected profits vary by crop, location, season and market conditions.
- Checkout is a demo until a payment provider is connected.

## 📌 Project Goal

The project is designed as a portfolio-ready full-stack agriculture platform that demonstrates authentication, PostgreSQL data modelling, REST APIs, marketplace workflows, admin controls, responsive UI and practical farmer-focused tools.
