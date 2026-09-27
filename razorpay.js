const crypto = require("crypto");

module.exports = function setupRazorpay({ app, pool, requireAuth }) {
  const keyId = process.env.RAZORPAY_KEY_ID || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";

  const configured = () => Boolean(keyId && keySecret);
  const configError = () => Object.assign(new Error("Razorpay is not configured on the server."), { status: 503 });

  function verifySignature(orderId, paymentId, signature) {
    if (!configured()) throw configError();
    const expected = crypto.createHmac("sha256", keySecret).update(orderId + "|" + paymentId).digest("hex");
    return typeof signature === "string" &&
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async function razorpay(path, options = {}) {
    if (!configured()) throw configError();
    const response = await fetch("https://api.razorpay.com/v1" + path, {
      ...options,
      headers: {
        Authorization: "Basic " + Buffer.from(keyId + ":" + keySecret).toString("base64"),
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error?.description || "Razorpay API request failed."), { status: 502 });
    return data;
  }

  app.get("/api/payments/config", requireAuth, async (_req, res) => {
    res.json({ provider: "razorpay", enabled: configured(), keyId: keyId || null, currency: "INR" });
  });

  app.post("/api/payments/razorpay/order", requireAuth, async (req, res) => {
    try {
      const fulfillmentMethod = String(req.body?.fulfillmentMethod || "delivery").trim().toLowerCase();
      const deliveryAddress = String(req.body?.deliveryAddress || "").trim().slice(0, 500);
      const deliveryPhone = String(req.body?.deliveryPhone || "").trim();

      if (!["delivery", "pickup"].includes(fulfillmentMethod)) return res.status(400).json({ error: "Invalid fulfillment method." });
      if (fulfillmentMethod === "delivery" && (!deliveryAddress || !/^\d{10}$/.test(deliveryPhone))) {
        return res.status(400).json({ error: "Delivery address and valid 10-digit phone are required." });
      }
      if (fulfillmentMethod === "pickup" && deliveryPhone && !/^\d{10}$/.test(deliveryPhone)) {
        return res.status(400).json({ error: "Enter a valid 10-digit phone number." });
      }

      const { rows } = await pool.query(
        "SELECT ci.product_id,ci.quantity,p.name,p.price,p.stock FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=$1 ORDER BY ci.id",
        [req.auth.id]
      );
      if (!rows.length) return res.status(400).json({ error: "Cart is empty." });

      let total = 0;
      for (const item of rows) {
        if (item.stock < item.quantity) return res.status(409).json({ error: "Not enough stock for " + item.name + "." });
        total += Number(item.price) * Number(item.quantity);
      }

      const gatewayOrder = await razorpay("/orders", {
        method: "POST",
        body: JSON.stringify({
          amount: Math.round(total * 100),
          currency: "INR",
          receipt: "OFS-" + Date.now() + "-" + req.auth.id,
          notes: { user_id: String(req.auth.id), fulfillment_method: fulfillmentMethod }
        })
      });

      await pool.query(
        "INSERT INTO payment_intents (user_id,provider_order_id,amount,currency,status) VALUES ($1,$2,$3,'INR','created') ON CONFLICT (provider_order_id) DO NOTHING",
        [req.auth.id, gatewayOrder.id, total]
      );

      res.status(201).json({
        provider: "razorpay",
        keyId,
        orderId: gatewayOrder.id,
        amount: gatewayOrder.amount,
        currency: gatewayOrder.currency
      });
    } catch (error) {
      console.error(error);
      res.status(error.status || 500).json({ error: error.message || "Unable to create payment order." });
    }
  });

  app.post("/api/payments/razorpay/webhook", async (req, res) => {
    try {
      if (!webhookSecret) return res.status(503).json({ error: "Razorpay webhook is not configured." });

      const signature = String(req.headers["x-razorpay-signature"] || "");
      const raw = req.rawBody || Buffer.from("");
      const expected = crypto.createHmac("sha256", webhookSecret).update(raw).digest("hex");
      if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
        return res.status(400).json({ error: "Invalid webhook signature." });
      }

      const event = req.body?.event;
      const payment = req.body?.payload?.payment?.entity;
      const order = req.body?.payload?.order?.entity;
      const providerOrderId = payment?.order_id || order?.id;
      const providerPaymentId = payment?.id || null;

      if (providerOrderId) {
        if (event === "payment.captured" || event === "order.paid") {
          await pool.query(
            "UPDATE payment_intents SET status='paid',provider_payment_id=COALESCE($1,provider_payment_id),verified_at=COALESCE(verified_at,NOW()) WHERE provider_order_id=$2",
            [providerPaymentId, providerOrderId]
          );
          await pool.query(
            "UPDATE orders SET payment_status='paid',payment_paid_at=COALESCE(payment_paid_at,NOW()) WHERE razorpay_order_id=$1",
            [providerOrderId]
          );
        } else if (event === "payment.failed") {
          await pool.query(
            "UPDATE payment_intents SET status='failed',provider_payment_id=COALESCE($1,provider_payment_id) WHERE provider_order_id=$2",
            [providerPaymentId, providerOrderId]
          );
          await pool.query(
            "UPDATE orders SET payment_status='failed' WHERE razorpay_order_id=$1 AND payment_status<>'paid'",
            [providerOrderId]
          );
        }
      }

      res.json({ received: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Webhook processing failed." });
    }
  });

  app.post("/api/orders", requireAuth, async (req, res, next) => {
    if (String(req.body?.paymentMethod || "").trim().toLowerCase() !== "razorpay") return next();

    try {
      const razorpayOrderId = String(req.body?.razorpayOrderId || "").trim();
      const razorpayPaymentId = String(req.body?.razorpayPaymentId || "").trim();
      const razorpaySignature = String(req.body?.razorpaySignature || "").trim();

      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return res.status(400).json({ error: "Razorpay payment verification details are required." });
      }
      if (!verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
        return res.status(400).json({ error: "Razorpay payment signature verification failed." });
      }

      const intent = await pool.query(
        "SELECT id,amount,status FROM payment_intents WHERE provider_order_id=$1 AND user_id=$2",
        [razorpayOrderId, req.auth.id]
      );
      if (!intent.rows[0]) return res.status(400).json({ error: "Razorpay payment order was not created for this account." });
      if (!["created", "paid"].includes(intent.rows[0].status)) return res.status(409).json({ error: "This Razorpay payment cannot be used again." });

      const cart = await pool.query(
        "SELECT ci.quantity,p.price,p.stock FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=$1",
        [req.auth.id]
      );
      if (!cart.rows.length) return res.status(400).json({ error: "Cart is empty." });

      const total = cart.rows.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
      if (Math.abs(Number(intent.rows[0].amount) - total) > 0.009) {
        return res.status(409).json({ error: "Payment amount no longer matches the cart total. Please retry checkout." });
      }
      if (cart.rows.some(item => Number(item.stock) < Number(item.quantity))) {
        return res.status(409).json({ error: "Stock changed while payment was processing. Please retry checkout." });
      }

      const originalJson = res.json.bind(res);
      res.json = async (body) => {
        try {
          if (body?.order?.id) {
            await pool.query(
              "UPDATE orders SET payment_method='razorpay',payment_status='paid',razorpay_order_id=$1,razorpay_payment_id=$2,razorpay_signature=$3,payment_paid_at=NOW() WHERE id=$4 AND user_id=$5",
              [razorpayOrderId, razorpayPaymentId, razorpaySignature, body.order.id, req.auth.id]
            );
            await pool.query(
              "UPDATE payment_intents SET status='consumed',provider_payment_id=$1,verified_at=COALESCE(verified_at,NOW()) WHERE id=$2",
              [razorpayPaymentId, intent.rows[0].id]
            );
            body.order.payment_method = "razorpay";
            body.order.payment_status = "paid";
            body.order.razorpay_order_id = razorpayOrderId;
            body.order.razorpay_payment_id = razorpayPaymentId;
          }
        } catch (error) {
          console.error("Razorpay post-order persistence error:", error);
        }
        return originalJson(body);
      };

      req.body.paymentMethod = "demo_upi";
      return next();
    } catch (error) {
      console.error(error);
      return res.status(error.status || 500).json({ error: error.message || "Unable to verify Razorpay payment." });
    }
  });

  pool.query("CREATE TABLE IF NOT EXISTS payment_intents (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,provider VARCHAR(30) NOT NULL DEFAULT 'razorpay',provider_order_id VARCHAR(80) UNIQUE NOT NULL,amount NUMERIC(10,2) NOT NULL,currency VARCHAR(3) NOT NULL DEFAULT 'INR',status VARCHAR(30) NOT NULL DEFAULT 'created',provider_payment_id VARCHAR(80),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),verified_at TIMESTAMPTZ)").catch(error => console.error("Payment table init failed:", error));
  pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(80)").catch(() => {});
  pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(80)").catch(() => {});
  pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature TEXT").catch(() => {});
  pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_paid_at TIMESTAMPTZ").catch(() => {});
  pool.query("CREATE UNIQUE INDEX IF NOT EXISTS orders_razorpay_order_unique ON orders(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL").catch(() => {});
};