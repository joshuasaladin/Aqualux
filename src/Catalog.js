/**
 * Aqua Lux Aruba service catalog — GUEST-SAFE data only.
 *
 * Deliberately contains NO vendor names, phone numbers, emails or booking
 * methods. Commission figures appear only as numbers because, per Josh's
 * rule, the downpayment collected from the guest equals Aqua Lux's
 * commission; they are never rendered into guest-facing text (the outbound
 * leak guard in Guard.js enforces this).
 *
 * Pricing types:
 *   flat              — one price per setup/booking            {price}
 *   perPerson         — price × party size                     {price}
 *   perVehicle        — one price per vehicle/unit             {price}
 *   adultChild        — adult price × adults + child × kids    {adult, child}
 *   perHour           — rate × hours                           {rate, minHours, maxHours}
 *   tieredPerPerson   — per-person price depends on group size {tiers:[{min,max,price}]}
 *   groupFormula      — base for N + extra per person          {base, included, extraPerPerson, maxPeople}
 *   quote             — no reliable price on file; never auto-invoice, warm
 *                       "we'd love to arrange this" reply + owner review
 *   review            — catalog ambiguity (see reason); never auto-invoice,
 *                       flag for owner
 *
 * Commission types (= guest downpayment):
 *   pct               — value × guest total (value is 0–1)
 *   flat              — fixed dollar amount per booking
 *   flatPerPerson     — fixed dollars × party size
 *   pctPlusPerPerson  — pct × total + perPerson × party size
 *   unknown           — cannot compute downpayment → needs-review
 *
 * Variant matching: each variant lists `match`, an array of keyword groups.
 * A variant matches when EVERY group has at least one keyword found in the
 * submission's choice fields (AND of ORs, case-insensitive).
 */
const CATALOG = [

  // ───────────────────────── WATER ACTIVITY ─────────────────────────
  {
    id: 'pirates-sail',
    category: 'Water Activity',
    formNames: ['Pirates Sail Boat', 'Pirate Sail', 'Pirates Sailing'],
    name: 'Pirates Sail Boat Tour',
    description: 'Set sail aboard a legendary pirate ship for swimming, snorkeling over shipwrecks, rope swinging, and island vibes on the open Caribbean Sea.',
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
    description: 'Glide along Aruba’s coastline on a spacious catamaran with snorkel stops in crystal-clear water, an open bar, and endless ocean views.',
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
      { name: '10-seater Private Boat', match: [['10']], timing: '3–8 hours (latest finish 7pm)',
        pricing: { type: 'perHour', rate: 200, minHours: 3, maxHours: 8 } },
      { name: '15-seater Private Boat', match: [['15']], timing: '3–8 hours (latest finish 7pm)',
        pricing: { type: 'perHour', rate: 300, minHours: 3, maxHours: 8 } }
    ]
  },
  {
    id: 'private-sailing',
    category: 'Water Activity',
    formNames: ['Private Sailing'],
    name: 'Private Sailing Charter',
    description: 'A fully private luxury sail with your own chef on board, premium liquor, and underwater scooters — the ultimate day on the water.',
    commission: { type: 'pct', value: 0.10 },
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
    description: 'Paddle a crystal-clear kayak over turquoise water while a professional drone captures breathtaking aerial photos and video of your experience.',
    commission: { type: 'pct', value: 0.40 },
    variants: [
      { name: 'Clear Kayak Drone Shoot', match: [], timing: '1 hour',
        pricing: { type: 'flat', price: 400 } }
    ]
  },
  {
    id: 'water-sports',
    category: 'Water Activity',
    formNames: ['Water Sports', 'Watersports'],
    name: 'Water Sports',
    description: 'Pure adrenaline on the water — soar, splash, and speed along Aruba’s famous coastline.',
    variants: [
      // Flagged in docs/PRICING_REVIEW.md: assumed per person — confirm.
      { name: 'Parasailing', match: [['parasail']], timing: '10–12 minutes in the air',
        pricing: { type: 'perPerson', price: 70 }, commission: { type: 'flatPerPerson', value: 20 } },
      { name: 'Tubing', match: [['tubing', 'tube']], timing: '15–20 minutes',
        pricing: { type: 'perPerson', price: 25 }, commission: { type: 'flatPerPerson', value: 5 } },
      { name: 'Jet Ski', match: [['jet']], timing: '30 minutes',
        pricing: { type: 'perPerson', price: 85 }, commission: { type: 'flatPerPerson', value: 15 } }
    ]
  },

  // ─────────────────────────── ADVENTURE ───────────────────────────
  {
    id: 'utv-tour',
    category: 'Adventure',
    formNames: ['UTV Tours', 'UTV Tour'],
    name: 'UTV Guided Tour',
    description: 'Take the wheel of your own UTV and roar through Aruba’s rugged outback — hidden beaches, desert trails, and natural pools await.',
    partySizeIsVehicleCapacity: true,
    variants: [
      { name: 'UTV Tour — 2-seater', match: [['2-seat', '2 seat', 'two seat']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 2,
        pricing: { type: 'perVehicle', price: 190 }, commission: { type: 'flat', value: 20 } },
      { name: 'UTV Tour — 3-seater', match: [['3-seat', '3 seat', 'three seat']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 3,
        pricing: { type: 'perVehicle', price: 285 }, commission: { type: 'flat', value: 30 } },
      { name: 'UTV Tour — 4-seater', match: [['4-seat', '4 seat', 'four seat']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 4,
        pricing: { type: 'perVehicle', price: 380 }, commission: { type: 'flat', value: 40 } },
      { name: 'UTV Tour — 5-seater', match: [['5-seat', '5 seat', 'five seat']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 5,
        pricing: { type: 'perVehicle', price: 475 }, commission: { type: 'flat', value: 40 } }
    ]
  },
  {
    id: 'utv-rental',
    category: 'Adventure',
    formNames: ['UTV Rental'],
    name: 'UTV Rental',
    description: 'Explore Aruba’s wild side at your own pace with a self-drive UTV rental.',
    partySizeIsVehicleCapacity: true,
    variants: [
      { name: 'UTV Rental — 2-seater, 4 hours', match: [['2-seat', '2 seat', 'two seat'], ['4 hour', '4-hour', 'half']], seats: 2,
        pricing: { type: 'perVehicle', price: 230 }, commission: { type: 'flat', value: 20 } },
      { name: 'UTV Rental — 2-seater, 8 hours', match: [['2-seat', '2 seat', 'two seat'], ['8 hour', '8-hour', 'full']], seats: 2,
        pricing: { type: 'perVehicle', price: 270 }, commission: { type: 'flat', value: 20 } },
      { name: 'UTV Rental — 3/4/5-seater, 4 hours', match: [['3-seat', '4-seat', '5-seat', '3 seat', '4 seat', '5 seat'], ['4 hour', '4-hour', 'half']], seats: 5,
        pricing: { type: 'perVehicle', price: 280 }, commission: { type: 'flat', value: 30 } },
      { name: 'UTV Rental — 3/4/5-seater, 8 hours', match: [['3-seat', '4-seat', '5-seat', '3 seat', '4 seat', '5 seat'], ['8 hour', '8-hour', 'full']], seats: 5,
        pricing: { type: 'perVehicle', price: 340 }, commission: { type: 'flat', value: 30 } }
    ]
  },
  {
    id: 'atv-tour',
    category: 'Adventure',
    formNames: ['ATV Tour', 'ATV Tours'],
    name: 'ATV Guided Tour',
    description: 'Ride an ATV across Aruba’s desert landscape on a guided adventure to the island’s most dramatic natural landmarks.',
    partySizeIsVehicleCapacity: true,
    variants: [
      { name: 'ATV Tour — 1-seater', match: [['1-seat', '1 seat', 'one seat', 'single']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 1,
        pricing: { type: 'perVehicle', price: 130 }, commission: { type: 'flat', value: 20 } },
      { name: 'ATV Tour — 2-seater', match: [['2-seat', '2 seat', 'two seat', 'double']], timing: '9:00am – 1:00pm or 2:30pm – 6:30pm', seats: 2,
        pricing: { type: 'perVehicle', price: 170 }, commission: { type: 'flat', value: 30 } }
    ]
  },
  {
    id: 'atv-rental',
    category: 'Adventure',
    formNames: ['ATV Rental'],
    name: 'ATV Rental',
    description: 'Freedom on four wheels — a self-drive ATV rental to discover Aruba’s rugged north coast on your own schedule.',
    partySizeIsVehicleCapacity: true,
    variants: [
      { name: 'ATV Rental — 1-seater, 4 hours', match: [['1-seat', '1 seat', 'single'], ['4 hour', '4-hour', 'half']], seats: 1,
        pricing: { type: 'perVehicle', price: 130 }, commission: { type: 'flat', value: 20 } },
      { name: 'ATV Rental — 1-seater, 8 hours', match: [['1-seat', '1 seat', 'single'], ['8 hour', '8-hour', 'full']], seats: 1,
        pricing: { type: 'perVehicle', price: 160 }, commission: { type: 'flat', value: 20 } },
      { name: 'ATV Rental — 2-seater, 4 hours', match: [['2-seat', '2 seat', 'double'], ['4 hour', '4-hour', 'half']], seats: 2,
        pricing: { type: 'perVehicle', price: 150 }, commission: { type: 'flat', value: 30 } },
      { name: 'ATV Rental — 2-seater, 8 hours', match: [['2-seat', '2 seat', 'double'], ['8 hour', '8-hour', 'full']], seats: 2,
        pricing: { type: 'perVehicle', price: 180 }, commission: { type: 'flat', value: 30 } }
    ]
  },
  {
    id: 'jeep-tour',
    category: 'Adventure',
    formNames: ['Private Jeep Tour', 'Jeep Tour'],
    name: 'Private Jeep Tour',
    description: 'A private open-air jeep adventure to Aruba’s natural pool, caves, and coastline with a guide all to yourselves.',
    // Info sheet: $100 p/p, commission "20" — unclear if that 20 is per
    // person or per booking, so the downpayment cannot be computed safely.
    variants: [
      { name: 'Private Jeep Tour', match: [], timing: '9:00am – 1:00pm',
        pricing: { type: 'perPerson', price: 100 }, commission: { type: 'unknown' } }
    ]
  },
  {
    id: 'safari',
    category: 'Adventure',
    formNames: ['Open-Air Safari', 'Open Air Safari', 'Safari'],
    name: 'Open-Air Safari',
    description: 'A customizable open-air safari — build your own island route and explore Aruba’s highlights in comfort with your group.',
    // Info sheet lists no commission for this service → downpayment unknown.
    variants: [
      { name: 'Open-Air Safari — 6-seater', match: [['6']], timing: 'Min 3 hours, max 8 hours (6am–6pm)', seats: 6,
        pricing: { type: 'perHour', rate: 110, minHours: 3, maxHours: 8, over4Rate: 60 }, commission: { type: 'unknown' } },
      { name: 'Open-Air Safari — 9-seater', match: [['9']], timing: 'Min 3 hours, max 8 hours (6am–6pm)', seats: 9,
        pricing: { type: 'perHour', rate: 130, minHours: 3, maxHours: 8, over4Rate: 70 }, commission: { type: 'unknown' } }
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
    // Flagged in docs/PRICING_REVIEW.md: prices assumed per person — confirm.
    variants: [
      { name: 'Swedish Massage — 60 minutes', match: [['swedish'], ['60', 'hour']],
        pricing: { type: 'perPerson', price: 120 } },
      { name: 'Swedish Massage — 90 minutes', match: [['swedish'], ['90']],
        pricing: { type: 'perPerson', price: 170 } },
      // Info sheet lists two different 60-minute prices for Hot Stone
      // ($135 and $165) — never auto-price until resolved.
      { name: 'Hot Stone Massage', match: [['hot stone', 'hotstone']],
        pricing: { type: 'review', reason: 'Info sheet lists two conflicting 60-minute prices for Hot Stone ($135 and $165).' } },
      { name: 'Deep Tissue Massage — 60 minutes', match: [['deep'], ['60', 'hour']],
        pricing: { type: 'perPerson', price: 135 } },
      { name: 'Deep Tissue Massage — 90 minutes', match: [['deep'], ['90']],
        pricing: { type: 'perPerson', price: 155 } },
      { name: 'Facial — 60 minutes', match: [['facial']],
        pricing: { type: 'perPerson', price: 120 } }
    ]
  },

  // ───────────────────────── PRIVATE CUISINE ─────────────────────────
  {
    id: 'chef-buffet',
    category: 'Private Cuisine',
    formNames: ['Private Chef Buffet', 'Private Chef', 'Chef Buffet'],
    name: 'Private Chef Experience',
    description: 'A private chef arrives at your villa an hour ahead and creates a restaurant-worthy dining experience just for your party.',
    commission: { type: 'pctPlusPerPerson', pct: 0.10, perPerson: 5 },
    variants: [
      { name: 'Private Chef — Breakfast', match: [['breakfast']],
        pricing: { type: 'tieredPerPerson', tiers: [
          { min: 2, max: 3, price: 65 }, { min: 4, max: 8, price: 50 }, { min: 9, max: 99, price: 45 }] } },
      { name: 'Private Chef — Brunch', match: [['brunch']],
        pricing: { type: 'tieredPerPerson', tiers: [
          { min: 2, max: 3, price: 85 }, { min: 4, max: 8, price: 70 }, { min: 9, max: 99, price: 65 }] } },
      { name: 'Private Chef — 3-Course / Caribbean Menu', match: [['3 course', '3-course', 'three course', 'caribbean']],
        pricing: { type: 'tieredPerPerson', tiers: [
          { min: 1, max: 2, price: 140 }, { min: 3, max: 4, price: 120 }, { min: 5, max: 7, price: 110 },
          { min: 8, max: 10, price: 100 }, { min: 11, max: 99, price: 90 }] } },
      { name: 'Private Chef — Local Menu', match: [['local']],
        pricing: { type: 'tieredPerPerson', tiers: [{ min: 8, max: 99, price: 80 }] } },
      { name: 'Private Chef — Grill / BBQ', match: [['grill', 'bbq', 'barbecue']],
        pricing: { type: 'tieredPerPerson', tiers: [{ min: 8, max: 99, price: 100 }] } },
      { name: 'Private Chef — Taco Night', match: [['taco']],
        pricing: { type: 'tieredPerPerson', tiers: [{ min: 6, max: 99, price: 70 }] } },
      // Add-ons: mimosas $15 / kids menu $25 have unclear per-person and
      // commission treatment — flag rather than compute.
      { name: 'Private Chef — with add-ons (mimosas / kids menu)', match: [['mimosa', 'kids menu', 'kid’s menu', "kid's menu"]],
        pricing: { type: 'review', reason: 'Add-on pricing (mimosas $15, kids menu $25) is unclear (per person? commission treatment?) — price manually.' } }
    ]
  },
  {
    id: 'flo-chef',
    category: 'Private Cuisine',
    formNames: ['Private Cookout', 'Paella', 'Cookout', 'Private Cookout & Paella'],
    name: 'Private Cookout & Paella',
    description: 'An authentic open-fire feast prepared live at your villa — paella and cookout menus that turn dinner into an event.',
    commission: { type: 'flatPerPerson', value: 15 },
    variants: [
      { name: 'Paella Experience', match: [['paella']],
        pricing: { type: 'tieredPerPerson', tiers: [{ min: 1, max: 9, price: 55 }, { min: 10, max: 99, price: 50 }] } },
      { name: 'Cookout — Menu Option 1', match: [['cookout'], ['1', 'one']],
        pricing: { type: 'perPerson', price: 75 } },
      { name: 'Cookout — Menu Option 2', match: [['cookout'], ['2', 'two']],
        pricing: { type: 'perPerson', price: 70 } },
      { name: 'Cookout — Menu Option 3', match: [['cookout'], ['3', 'three']],
        pricing: { type: 'perPerson', price: 70 } }
    ]
  },

  // ───────────────────────────── MOMENTS ─────────────────────────────
  {
    id: 'beach-picnic',
    category: 'Moments',
    formNames: ['Beach Picnic'],
    name: 'Luxury Beach Picnic',
    description: 'A beautifully styled beachside picnic — an elegant setup, gourmet flavors, and the Caribbean as your backdrop.',
    commission: { type: 'flat', value: 15 },
    variants: [
      { name: 'Breakfast Original Set Up', match: [['breakfast'], ['original', 'og']],
        pricing: { type: 'flat', price: 88.5 } },
      { name: 'Breakfast Royale Set Up', match: [['breakfast'], ['royale', 'royal']],
        pricing: { type: 'flat', price: 115 } },
      { name: 'Gourmet Charcuterie OG', match: [['charcuterie'], ['og', 'original']],
        pricing: { type: 'flat', price: 108.5 } },
      { name: 'Gourmet Charcuterie Royale', match: [['charcuterie'], ['royale', 'royal']],
        pricing: { type: 'flat', price: 135 } },
      { name: 'Dinner Package', match: [['dinner']],
        pricing: { type: 'flat', price: 145 } },
      // Unclear if the kids package is per child; flag rather than compute.
      { name: 'Dinner Package Kids', match: [['kids', 'kid', 'children']],
        pricing: { type: 'review', reason: 'Dinner Package Kids ($30) — unclear whether per child or per setup.' },
        commission: { type: 'flat', value: 5 } }
    ]
  },
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
    // Info sheet says commission is "$ on top" with no amount, and notes the
    // 6–10 person prices have "no commission added" — the true guest price
    // cannot be derived, so this always goes to owner review.
    variants: [
      { name: 'Airport Transfer', match: [],
        pricing: { type: 'review', reason: 'Commission is "$ on top" with no amount specified; guest price cannot be derived from the sheet.' } }
    ]
  },
  {
    id: 'car-rental',
    category: 'Transportation',
    formNames: ['Car Rental'],
    name: 'Car Rental',
    description: 'Explore Aruba on your own terms with a quality rental delivered with airport pick-up included.',
    // Per-day pricing needs rental length, and the security deposit's place
    // on the invoice is unresolved — always goes to owner review.
    variants: [
      { name: 'Car Rental', match: [],
        pricing: { type: 'review', reason: 'Per-day pricing needs number of days, and deposit handling ($300–$500) on the invoice is undecided.' } }
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
 * Field labels that carry logistics rather than a service choice; their
 * values are excluded from variant matching (a party of "10" must not match
 * the "10-seater", menu "Option 1", etc.).
 */
const NON_CHOICE_FIELD_KEYS = [
  'first name', 'last name', 'email', 'e-mail', 'date', 'time',
  'where are you staying', 'staying', 'resort', 'accommodation',
  'questions', 'comments', 'special requests', 'phone',
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
      return !NON_CHOICE_FIELD_KEYS.some(k => l.indexOf(k) !== -1);
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
