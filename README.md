# Organic Farming System

A farmer-friendly web application for crop information, seasonal guidance, weather lookup and organic farming resources.

## Production stack

- Node.js + Express
- PostgreSQL
- bcryptjs + JWT authentication
- OpenWeather API through a protected server endpoint
- Render Blueprint for web service + PostgreSQL

## Run locally

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL`, `JWT_SECRET`, and `WEATHER_API_KEY`.
4. Install dependencies:

```bash
npm install
```

5. Start the server:

```bash
npm start
```

6. Open `http://localhost:3000`.

## Deployment

The repository includes `render.yaml`. In Render, create a new Blueprint from the `deployment-ready` branch. Render can provision the web service and PostgreSQL database from the Blueprint; the weather API key is intentionally requested as a secret. Render documents Blueprint setup and `fromDatabase` environment-variable wiring in its Blueprint reference. 

## Security notes

- Passwords are hashed with bcrypt and are never stored in browser localStorage.
- JWT signing uses the `JWT_SECRET` environment variable.
- The OpenWeather API key is kept server-side.
- Do not commit `.env` or database credentials.
- Payment remains a demo flow until a real payment provider is intentionally integrated.
