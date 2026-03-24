const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

async function createProductCatalog() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("❌ Error: STRIPE_SECRET_KEY is missing in .env file.");
    return;
  }

  try {
    console.log("🚀 Initializing PersonaPlex Product Catalog...");

    // 1. One-time Setup Fee
    const setupFee = await stripe.products.create({
      name: 'ChatVora AI Setup Fee',
      description: 'Custom AI training, widget integration, and account configuration.',
    });

    const setupPrice = await stripe.prices.create({
      unit_amount: 4900, // $49.00 (Lowered from $499)
      currency: 'usd',
      product: setupFee.id,
    });

    console.log(`✅ Created Setup Fee Product: ${setupFee.id} | Price: ${setupPrice.id}`);

    // 2. Monthly Subscription
    const monthlySub = await stripe.products.create({
      name: 'Monthly AI Support & Hosting',
      description: 'Continuous AI updates, 24/7 hosting, and priority support.',
    });

    const monthlyPrice = await stripe.prices.create({
      unit_amount: 2900, // $29.00 (Lowered from $149)
      currency: 'usd',
      recurring: { interval: 'month' },
      product: monthlySub.id,
    });

    console.log(`✅ Created Monthly Subscription: ${monthlySub.id} | Price: ${monthlyPrice.id}`);
    
    console.log("\n✨ Product Catalog initialization complete!");
    console.log("Add these Price IDs to your environment variables to start selling.");

  } catch (error) {
    console.error("❌ Stripe Setup Failed:", error.message);
  }
}

createProductCatalog();
