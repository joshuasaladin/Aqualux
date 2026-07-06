/**
 * Aqua Lux Aruba service catalog — GUEST-SAFE data only.
 * Rebuilt from Josh's reorganized Concierge Info Sheet (v3.1).
 *
 * Deliberately contains NO vendor contacts or booking methods. Commission
 * figures appear only as numbers because the downpayment collected from the
 * guest equals Aqua Lux's commission; they are never rendered into
 * guest-facing text (the outbound leak guard in Guard.js enforces this).
 * Vendor-derived form names (Jolly Pirates, AWA Aruba) are the PUBLIC names
 * of the Wix forms on the website, used for matching only.
 *
 * Pricing types:
 *   flat              — one price per setup/booking            {price}
 *   perPerson         — price × party size                     {price, minPeople?}
 *   perVehicle        — one price per vehicle/unit             {price}
 *   adultChild        — adult price × adults + child × kids    {adult, child}
 *   perHour           — rate × hours; over4Rate applies to     {rate, minHours, maxHours, over4Rate?}
 *                       hours beyond the 4th (per Josh)
 *   tieredPerPerson   — per-person price depends on group size {tiers:[{min,max,price}]}
 *   groupFormula      — base for N + extra per person          {base, included, extraPerPerson, maxPeople}
 *   inquire           — email quote + booking questions, no    {priceText}
 *                       invoice (car rental); Josh confirms
 *   quote             — no price on file; warm follow-up reply
 *                       (optionally asking service.quoteRequest) + owner review
 *   review            — unresolved ambiguity; never auto-invoice
 *
 * Commission types (= guest downpayment):
 *   pct | flat | flatPerPerson | pctPlusPerPerson | unknown
 */
const CATALOG = [

  // ───────────────────────── WATER ACTIVITY ─────────────────────────
  {
    id: 'pirates-sail',
    category: 'Water Activity',
    formNames: ['Jolly Pirates', 'Pirates Sail Boat', 'Pirate Sail', 'Pirates Sailing'],
    name: 'Pirates Sail Boat Tour',
    description: 'Set sail aboard a legendary pirate ship — swim, snorkel, and rope-swing your way along Aruba’s coast.',
    commission: { type: 'pct', value: 0.15 },
    variants: [
      { name: 'Morning Tour', match: [['morning']], timing: '9:00am – 1:00pm',
        pricing: { type: 'adultChild', adult: 86, child: 60 } },
      { name: 'Afternoon Tour', match: [['afternoon']], timing: '2:00pm – 5:00pm',
        pricing: { type: 'adultChild', adult: 67, child: 47 } },
      { name: 'Sunset Tour', match: [['sunset']], timing: '5:30pm – 7:30pm',
        pricing: { type: 'adultChild', adult: 52, child: 43 } }
    ]
  },
  {
    id: 'catamaran',
    category: 'Water Activity',
    formNames: ['Catamaran Tour', 'Catamaran'],
    name: 'Catamaran Tour',
    description: 'Glide along Aruba’s coastline on a spacious catamaran with snorkel stops in crystal-clear water and endless ocean views.',
    commission: { type: 'pct', value: 0.15 },
    variants: [
      { name: 'Brunch Tour', match: [['brunch']], timing: '9:00am – 1:00pm',
        pricing: { type: 'adultChild', adult: 92, child: 58 } },
      { name: 'Afternoon Tour', match: [['afternoon']], timing: '2:00pm – 4:30pm',
        pricing: { type: 'adultChild', adult: 69, child: 49 } },
      { name: 'Sunset Tour', match: [['sunset']], timing: '5:30pm – 7:30pm',
        pricing: { type: 'adultChild', adult: 75, child: 53 } }
    ]
  },
  {
    id: 'private-boat',
    category: 'Water Activity',
    formNames: ['Private Boat'],
    name: 'Private Boat Charter',
    description: 'Your own private boat and captain — cruise, swim, and snorkel on your schedule with the island’s best spots all to yourselves.',
    commission: { type: 'pct', value: 0.15 },
    variants: [
      { name: '10-seater Private Boat', match: [['10']], seats: 10, timing: '3–8 hours (latest finish 7pm)',
        pricing: { type: 'perHour', rate: 200, minHours: 3, maxHours: 8 } },
      { name: '15-seater Private Boat', match: [['15']], seats: 15, timing: '3–8 hours (latest finish 7pm)',
        pricing: { type: 'perHour', rate: 300, minHours: 3, maxHours: 8 } }
    ]
  },
  {
    id: 'private-sailing',
    category: 'Water Activity',
    formNames: ['AWA Aruba', 'Private Sailing'],
    name: 'Private Sailing Charter',
    description: 'A fully private luxury sail with your own chef on board, premium liquor, and underwater scooters — the ultimate day on the water.',
    commission: { type: 'pct', value: 0.10 },
    optionAsk: 'whether you would like the Half Day, Full Day, or Sunset sail',
    variants: [
      { name: 'Half Day Sail', match: [['half']], timing: '10:30 AM – 2:30 PM',
        pricing: { type: 'groupFormula', base: 2000, included: 6, extraPerPerson: 50, maxPeople: 15 } },
      { name: 'Full Day Sail', match: [['full']], timing: '10:30 AM – 6:30 PM or 11:30 AM – 7:30 PM',
        pricing: { type: 'groupFormula', base: 3000, included: 6, extraPerPerson: 50, maxPeople: 15 } },
      { name: 'Sunset Sail', match: [['sunset']], timing: '3:30 PM – 7:30 PM',
        pricing: { type: 'groupFormula', base: 2000, included: 6, extraPerPerson: 50, maxPeople: 15 } }
    ]
  },
  {
    id: 'clear-kayak',
    category: 'Water Activity',
    formNames: ['Clear Kayak', 'Clear Kayak Drone Shoot'],
    name: 'Clear Kayak Drone Shoot',
    description: 'Paddle a crystal-clear kayak over turquoise water while a professional drone captures breathtaking photos and video of your experience.',
    commission: { type: 'pct', value: 0.40 },
    variants: [
      { name: 'Clear Kayak Drone Shoot', match: [], timing: '1 hour',
        pricing: { type: 'flat', price: 400 } }
    ]
  },
  {
    id: 'water-sports',
    category: 'Water Activity',
    formNames: ['Parasailing & Tubing', 'Water Sports', 'Watersports', 'Parasailing', 'Tubing', 'Jet Ski'],
    name: 'Water Sports',
    description: 'Pure adrenaline on the water — soar, splash, and speed along Aruba’s famous coastline.',
    partySizeIsVehicleCapacity: true,
    optionAsk: 'which activity you would like — parasailing, tubing, or jet ski',
    variants: [
      { name: 'Parasailing', match: [['parasail']], timing: '10–12 minutes in the air; goes out hourly from 10am',
        pricing: { type: 'perPerson', price: 70 }, commission: { type: 'flatPerPerson', value: 20 } },
      { name: 'Tubing', match: [['tubing', 'tube']], timing: '15–20 minutes',
        pricing: { type: 'perPerson', price: 25 }, commission: { type: 'flatPerPerson', value: 5 } },
      // Per Josh: $85 is per jet ski (seats 2), not per rider.
      { name: 'Jet Ski', match: [['jet']], seats: 2, timing: '30 minutes; every half hour from 10:30',
        pricing: { type: 'perVehicle', price: 85 }, commission: { type: 'flat', value: 15 } }
    ]
  },

  // ─────────────────────────── ADVENTURE ───────────────────────────
  {
    id: 'utv',
    category: 'Adventure',
    formNames: ['UTV Tours & Rentals', 'UTV Tours', 'UTV Tour', 'UTV Rental', 'UTV'],
    name: 'UTV Adventure',
    description: 'Take the wheel of your own UTV and roar through Aruba’s rugged outback — hidden beaches, desert trails, and natural pools await.',
    partySizeIsVehicleCapacity: true,
    optionAsk: 'which UTV you would like — a 2-, 3-, 4-, or 5-seater (and whether you prefer the guided tour or a self-drive rental)',
    askPickup: true,
    variants: [
      { name: 'UTV Guided Tour — 2-seater', match: [['tour'], ['2-seat', '2 seat', 'two seat']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 2,
        pricing: { type: 'perVehicle', price: 190 }, commission: { type: 'flat', value: 20 } },
      { name: 'UTV Guided Tour — 3-seater', match: [['tour'], ['3-seat', '3 seat', 'three seat']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 3,
        pricing: { type: 'perVehicle', price: 285 }, commission: { type: 'flat', value: 30 } },
      { name: 'UTV Guided Tour — 4-seater', match: [['tour'], ['4-seat', '4 seat', 'four seat']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 4,
        pricing: { type: 'perVehicle', price: 380 }, commission: { type: 'flat', value: 40 } },
      { name: 'UTV Guided Tour — 5-seater', match: [['tour'], ['5-seat', '5 seat', 'five seat']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 5,
        pricing: { type: 'perVehicle', price: 475 }, commission: { type: 'flat', value: 40 } },
      { name: 'UTV Rental — 2-seater, 4 hours', match: [['rental', 'rent'], ['2-seat', '2 seat', 'two seat'], ['4 hour', '4-hour', 'half']], seats: 2,
        pricing: { type: 'perVehicle', price: 230 }, commission: { type: 'flat', value: 20 } },
      { name: 'UTV Rental — 2-seater, 8 hours', match: [['rental', 'rent'], ['2-seat', '2 seat', 'two seat'], ['8 hour', '8-hour', 'full']], seats: 2,
        pricing: { type: 'perVehicle', price: 270 }, commission: { type: 'flat', value: 20 } },
      { name: 'UTV Rental — 3/4/5-seater, 4 hours', match: [['rental', 'rent'], ['3-seat', '4-seat', '5-seat', '3 seat', '4 seat', '5 seat'], ['4 hour', '4-hour', 'half']], seats: 5,
        pricing: { type: 'perVehicle', price: 280 }, commission: { type: 'flat', value: 30 } },
      { name: 'UTV Rental — 3/4/5-seater, 8 hours', match: [['rental', 'rent'], ['3-seat', '4-seat', '5-seat', '3 seat', '4 seat', '5 seat'], ['8 hour', '8-hour', 'full']], seats: 5,
        pricing: { type: 'perVehicle', price: 340 }, commission: { type: 'flat', value: 30 } }
    ]
  },
  {
    id: 'atv',
    category: 'Adventure',
    formNames: ['ATV Tour & Rentals', 'ATV Tours & Rentals', 'ATV Tour', 'ATV Tours', 'ATV Rental', 'ATV'],
    name: 'ATV Adventure',
    description: 'Ride an ATV across Aruba’s desert landscape — dramatic natural landmarks, rugged trails, and pure freedom on four wheels.',
    partySizeIsVehicleCapacity: true,
    optionAsk: 'whether you would like a single-seater or a double-seater',
    askPickup: true,
    variants: [
      { name: 'ATV Guided Tour — 1-seater', match: [['tour'], ['1-seat', '1 seat', 'one seat', 'single']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 1,
        pricing: { type: 'perVehicle', price: 130 }, commission: { type: 'flat', value: 20 } },
      { name: 'ATV Guided Tour — 2-seater', match: [['tour'], ['2-seat', '2 seat', 'two seat', 'double']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 2,
        pricing: { type: 'perVehicle', price: 170 }, commission: { type: 'flat', value: 30 } },
      { name: 'ATV Rental — 1-seater, 4 hours', match: [['rental', 'rent'], ['1-seat', '1 seat', 'single'], ['4 hour', '4-hour', 'half']], seats: 1,
        pricing: { type: 'perVehicle', price: 130 }, commission: { type: 'flat', value: 20 } },
      { name: 'ATV Rental — 1-seater, 8 hours', match: [['rental', 'rent'], ['1-seat', '1 seat', 'single'], ['8 hour', '8-hour', 'full']], seats: 1,
        pricing: { type: 'perVehicle', price: 160 }, commission: { type: 'flat', value: 20 } },
      { name: 'ATV Rental — 2-seater, 4 hours', match: [['rental', 'rent'], ['2-seat', '2 seat', 'double'], ['4 hour', '4-hour', 'half']], seats: 2,
        pricing: { type: 'perVehicle', price: 150 }, commission: { type: 'flat', value: 30 } },
      { name: 'ATV Rental — 2-seater, 8 hours', match: [['rental', 'rent'], ['2-seat', '2 seat', 'double'], ['8 hour', '8-hour', 'full']], seats: 2,
        pricing: { type: 'perVehicle', price: 180 }, commission: { type: 'flat', value: 30 } }
    ]
  },
  {
    id: 'jeep-tour',
    category: 'Adventure',
    formNames: ['Private Jeep Tour', 'Jeep Tour'],
    name: 'Private Jeep Tour',
    description: 'A private open-air jeep adventure to Aruba’s natural pool, caves, and coastline with a guide all to yourselves.',
    // Per Josh: the $20 downpayment is per person.
    variants: [
      { name: 'Private Jeep Tour', match: [], timing: '9:00am – 1:00pm',
        pricing: { type: 'perPerson', price: 100 }, commission: { type: 'flatPerPerson', value: 20 } }
    ]
  },
  {
    id: 'safari',
    category: 'Adventure',
    formNames: ['Open-Air Safari', 'Open Air Safari', 'Safari'],
    name: 'Open-Air Safari',
    description: 'A customizable open-air safari — build your own island route and explore Aruba’s highlights in comfort with your group.',
    // Per Josh: lower rate applies to hours beyond the 4th; downpayment $40 flat.
    commission: { type: 'flat', value: 40 },
    variants: [
      { name: 'Open-Air Safari — 6-seater', match: [['6']], seats: 6, timing: 'Min 3 – max 8 hours, between 6am – 6pm',
        pricing: { type: 'perHour', rate: 110, minHours: 3, maxHours: 8, over4Rate: 60 } },
      { name: 'Open-Air Safari — 9-seater', match: [['9']], seats: 9, timing: 'Min 3 – max 8 hours, between 6am – 6pm',
        pricing: { type: 'perHour', rate: 130, minHours: 3, maxHours: 8, over4Rate: 70 } }
    ]
  },

  // ─────────────────────────── RELAXATION ───────────────────────────
  {
    id: 'massage',
    category: 'Relaxation',
    formNames: ['Private Massage', 'Massage', 'Spa'],
    name: 'Private In-Villa Massage',
    description: 'Resort-quality massage therapy brought directly to you — unwind with a private session at your villa, condo, or beachside.',
    commission: { type: 'pct', value: 0.30 },
    // Per Josh: when the form names the massage type without a duration,
    // don't ask — price the 60-minute session (default: true) and let the
    // confirmation show "— 60 minutes" so the guest can correct it.
    variants: [
      { name: 'Swedish Massage — 60 minutes', match: [['swedish'], ['60', 'hour']], default: true,
        pricing: { type: 'perPerson', price: 120 } },
      { name: 'Swedish Massage — 90 minutes', match: [['swedish'], ['90']],
        pricing: { type: 'perPerson', price: 170 } },
      { name: 'Hot Stone Massage — 60 minutes', match: [['hot stone', 'hotstone'], ['60', 'hour']], default: true,
        pricing: { type: 'perPerson', price: 135 } },
      // Per Josh: $165 is the 90-minute Hot Stone.
      { name: 'Hot Stone Massage — 90 minutes', match: [['hot stone', 'hotstone'], ['90']],
        pricing: { type: 'perPerson', price: 165 } },
      { name: 'Deep Tissue Massage — 60 minutes', match: [['deep'], ['60', 'hour']], default: true,
        pricing: { type: 'perPerson', price: 135 } },
      { name: 'Deep Tissue Massage — 90 minutes', match: [['deep'], ['90']],
        pricing: { type: 'perPerson', price: 155 } },
      { name: 'Facial — 60 minutes', match: [['facial']],
        pricing: { type: 'perPerson', price: 120 } }
    ]
  },

  // ───────────────────────── PRIVATE CUISINE ─────────────────────────
  // One Wix form ("Private Chef") covers both chefs; the guest's menu
  // choice decides the variant. attachMenu: the confirmation email attaches
  // the menu PDF when CHEF_MENU_FILE_ID is configured.
  {
    id: 'private-cuisine',
    category: 'Private Cuisine',
    formNames: ['Private Chef', 'Private Chef Buffet', 'Chef Buffet', 'Private Cookout', 'Paella', 'Cookout'],
    name: 'Private Chef Experience',
    description: 'A private chef arrives ahead of time and creates a restaurant-worthy dining experience just for your party, right where you’re staying.',
    attachMenu: true,
    variants: [
      { name: 'Private Chef — Breakfast', match: [['breakfast']],
        commission: { type: 'pctPlusPerPerson', pct: 0.10, perPerson: 5 },
        pricing: { type: 'tieredPerPerson', tiers: [
          { min: 2, max: 3, price: 65 }, { min: 4, max: 8, price: 50 }, { min: 9, max: 999, price: 45 }] } },
      { name: 'Private Chef — Brunch', match: [['brunch']],
        commission: { type: 'pctPlusPerPerson', pct: 0.10, perPerson: 5 },
        pricing: { type: 'tieredPerPerson', tiers: [
          { min: 2, max: 3, price: 85 }, { min: 4, max: 8, price: 70 }, { min: 9, max: 999, price: 65 }] } },
      { name: 'Private Chef — 3-Course / Caribbean Menu', match: [['3 course', '3-course', 'three course', 'caribbean']],
        commission: { type: 'pctPlusPerPerson', pct: 0.10, perPerson: 5 },
        pricing: { type: 'tieredPerPerson', tiers: [
          { min: 1, max: 2, price: 140 }, { min: 3, max: 4, price: 120 }, { min: 5, max: 7, price: 110 },
          { min: 8, max: 10, price: 100 }, { min: 11, max: 999, price: 90 }] } },
      { name: 'Private Chef — Local Menu', match: [['local']],
        commission: { type: 'pctPlusPerPerson', pct: 0.10, perPerson: 5 },
        pricing: { type: 'tieredPerPerson', tiers: [{ min: 8, max: 999, price: 80 }] } },
      { name: 'Private Chef — Grill / BBQ', match: [['grill', 'bbq', 'barbecue']],
        commission: { type: 'pctPlusPerPerson', pct: 0.10, perPerson: 5 },
        pricing: { type: 'tieredPerPerson', tiers: [{ min: 8, max: 999, price: 100 }] } },
      { name: 'Private Chef — Taco Night', match: [['taco']],
        commission: { type: 'pctPlusPerPerson', pct: 0.10, perPerson: 5 },
        pricing: { type: 'tieredPerPerson', tiers: [{ min: 6, max: 999, price: 70 }] } },
      // Add-ons: still awaiting Josh's pricing/commission answer.
      { name: 'Private Chef — with add-ons (mimosas / kids menu)', match: [['mimosa', 'kids menu', 'kid’s menu', "kid's menu"]],
        pricing: { type: 'review', reason: 'Add-on pricing (mimosas $15, kids menu $25) still unresolved — price manually.' } },
      { name: 'Paella Experience', match: [['paella']],
        commission: { type: 'flatPerPerson', value: 15 },
        pricing: { type: 'tieredPerPerson', tiers: [{ min: 1, max: 9, price: 55 }, { min: 10, max: 999, price: 50 }] } },
      { name: 'Cookout — Menu Option 1', match: [['cookout'], ['1', 'one']],
        commission: { type: 'flatPerPerson', value: 15 },
        pricing: { type: 'perPerson', price: 75, minPeople: 2 } },
      { name: 'Cookout — Menu Option 2', match: [['cookout'], ['2', 'two']],
        commission: { type: 'flatPerPerson', value: 15 },
        pricing: { type: 'perPerson', price: 70, minPeople: 2 } },
      { name: 'Cookout — Menu Option 3', match: [['cookout'], ['3', 'three']],
        commission: { type: 'flatPerPerson', value: 15 },
        pricing: { type: 'perPerson', price: 70, minPeople: 2 } }
    ]
  },

  // ───────────────────────────── MOMENTS ─────────────────────────────
  // NOTE: Beach Picnic was removed from Josh's edited info sheet, so it is
  // no longer in the catalog. "Beach Pic Nic" submissions now get the warm
  // personal-follow-up reply and a flag. Confirm with Josh this was intended.
  {
    id: 'floating-breakfast',
    category: 'Moments',
    formNames: ['Floating Breakfast'],
    name: 'Floating Breakfast',
    description: 'Wake up to a dream: a gorgeously styled breakfast floating on your private pool, ready for that perfect golden-hour photo before the first bite.',
    commission: { type: 'flat', value: 15 },
    variants: [
      { name: 'Vegan Breakfast', match: [['vegan']], pricing: { type: 'flat', price: 155 } },
      { name: 'Sweet Breakfast', match: [['sweet']], pricing: { type: 'flat', price: 155 } },
      { name: 'Big Breakfast', match: [['big']], pricing: { type: 'flat', price: 155 } }
    ]
  },
  {
    id: 'balloon-decoration',
    category: 'Moments',
    formNames: ['Balloon Decoration', 'Balloons'],
    name: 'Balloon Decoration',
    description: 'Celebration-ready balloon styling for birthdays, proposals, and special surprises.',
    // Per Josh: ask for inspiration pictures, then he quotes personally.
    quoteRequest: 'So we can create exactly what you have in mind, could you reply with a few inspiration pictures of the style you love? We’ll send you a personalized quote right away.',
    variants: [
      { name: 'Balloon Decoration', match: [], pricing: { type: 'quote' } }
    ]
  },
  {
    id: 'flowers',
    category: 'Moments',
    formNames: ['Flower Arrangements', 'Flowers'],
    name: 'Flower Arrangements',
    description: 'Fresh, elegant floral arrangements delivered and styled for your special moment.',
    quoteRequest: 'So we can create exactly what you have in mind, could you reply with a few inspiration pictures of the style you love? We’ll send you a personalized quote right away.',
    variants: [
      { name: 'Flower Arrangement', match: [], pricing: { type: 'quote' } }
    ]
  },

  // ─────────────────────────  TRANSPORTATION ─────────────────────────
  {
    id: 'airport-transport',
    category: 'Transportation',
    formNames: ['Airport Transportation', 'Airport Transfer'],
    name: 'Airport Transportation',
    description: 'Seamless private transfers between the airport and your accommodation — relaxed, comfortable, and right on time.',
    // Per Josh: prepare a fill-in-the-price draft ("comes out to $____")
    // asking for flight info, phone, and drop-off — he completes the amount
    // before sending. Always a draft, never auto-sent.
    variants: [
      { name: 'Airport Transfer', match: [], pricing: { type: 'manualQuote' } }
    ]
  },
  {
    id: 'car-rental',
    category: 'Transportation',
    formNames: ['Car Rental'],
    name: 'Car Rental',
    description: 'Explore Aruba on your own terms with a quality rental — airport pick-up included.',
    // Per Josh: no downpayment; guest confirms the price, then he confirms
    // with the vendor; guest pays the rental company at pickup. The reply
    // quotes the daily price and collects the booking details he needs.
    inquiryQuestions: [
      'how many days you’d like the car',
      'your full name',
      'your flight arrival details',
      'the best phone number to reach you',
      'a picture of your ID (needed for the rental agreement)'
    ],
    inquiryNote: 'There is no downpayment for car rentals — the rental amount is paid directly to the rental company when they pick you up at the airport, and a refundable security deposit applies.',
    variants: [
      { name: 'Sedan', match: [['sedan']],
        pricing: { type: 'inquire', priceText: 'The Sedan is $50 per day with airport pick-up included (refundable security deposit: $300).' } },
      { name: 'Mid-size SUV', match: [['mid-size', 'mid size', 'midsize']],
        pricing: { type: 'inquire', priceText: 'The Mid-size SUV is $85 per day with airport pick-up included (refundable security deposit: $500).' } },
      { name: 'SUV', match: [['suv']],
        pricing: { type: 'inquire', priceText: 'The SUV is $100 per day with airport pick-up included (refundable security deposit: $500).' } },
      { name: '11-Seater Van', match: [['van', '11']],
        pricing: { type: 'inquire', priceText: 'The 11-Seater Van is $100 per day with airport pick-up included (refundable security deposit: $500).' } },
      { name: 'Jeep', match: [['jeep']],
        pricing: { type: 'inquire', priceText: 'The Jeep is $250 per day with airport pick-up included (refundable security deposit: $500).' } }
    ]
  }
];

/** Find a catalog service by Wix form name (case-insensitive, fuzzy). */
function findServiceByFormName(formName) {
  if (!formName) return null;
  const norm = String(formName).toLowerCase().trim();
  for (const svc of CATALOG) {
    for (const fn of svc.formNames) {
      const f = fn.toLowerCase();
      if (norm === f || norm.indexOf(f) !== -1 || f.indexOf(norm) !== -1) return svc;
    }
  }
  return null;
}

/**
 * Identity/logistics field labels — never used for variant matching.
 */
const IDENTITY_FIELD_KEYS = [
  'first name', 'last name', 'email', 'e-mail', 'date', 'time',
  'where are you staying', 'staying', 'resort', 'accommodation',
  'questions', 'comments', 'special requests', 'phone'
];

/**
 * Count-type field labels — excluded from variant matching only when their
 * value is a bare number, so a party of "10" can't match the "10-seater"
 * but a duration choice of "8 hours" still can.
 */
const COUNT_FIELD_KEYS = [
  'people', 'guests', 'adults', 'children', 'kids', 'party', 'persons',
  'hours', 'duration'
];

/**
 * Pick the variant matching the submission's choice-field values.
 * Returns { variant } on a unique match, { candidates } when ambiguous,
 * or { variant: null } when nothing matches.
 */
function matchVariant(service, submission) {
  const haystack = Object.keys(submission.fields)
    .filter(label => {
      const l = label.toLowerCase();
      if (IDENTITY_FIELD_KEYS.some(k => l.indexOf(k) !== -1)) return false;
      if (COUNT_FIELD_KEYS.some(k => l.indexOf(k) !== -1)
          && /^[\d\s.,-]*$/.test(submission.fields[label])) return false;
      return true;
    })
    .map(k => submission.fields[k])
    .join(' \n ')
    .toLowerCase();

  if (service.variants.length === 1) return { variant: service.variants[0] };

  const hits = service.variants.filter(v =>
    (v.match || []).every(group => group.some(kw => keywordFound_(haystack, kw)))
    && (v.match || []).length > 0
  );

  if (hits.length === 1) return { variant: hits[0] };
  if (hits.length > 1) {
    // Prefer the variant with the most keyword groups satisfied (most specific).
    hits.sort((a, b) => b.match.length - a.match.length);
    if (hits[0].match.length > hits[1].match.length) return { variant: hits[0] };
    return { candidates: hits };
  }

  // Fallback: the first keyword group (the option's TYPE, e.g. "swedish")
  // matched but a secondary group (e.g. duration) didn't. If exactly one of
  // those partial matches is marked `default: true`, use it — per Josh, a
  // "Swedish" choice prices the 60-minute session rather than asking.
  const partial = service.variants.filter(v =>
    (v.match || []).length > 1 && v.match[0].some(kw => keywordFound_(haystack, kw)));
  const defaults = partial.filter(v => v.default);
  if (defaults.length === 1) return { variant: defaults[0], assumedDefault: true };
  if (partial.length) return { candidates: partial };

  return { variant: null };
}

/**
 * Keyword match with number safety: purely numeric keywords must stand alone
 * ("1" must not match inside "10"), digit-led keywords like "2-seat" must
 * start at a word boundary ("12-seater" must not match "2-seat"), and plain
 * words match as substrings.
 */
function keywordFound_(haystack, kw) {
  const k = kw.toLowerCase();
  if (/^\d+$/.test(k)) return new RegExp('\\b' + k + '\\b').test(haystack);
  if (/^\d/.test(k)) return new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(haystack);
  return haystack.indexOf(k) !== -1;
}
