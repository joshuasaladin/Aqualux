// What www.aqualuxaruba.com says about each service: name, provider, info
// and prices, captured from the live site. This is the only source of the
// Services pages; after that, prices are changed by hand in the CRM.
// `match` = the Wix form names, `aliases` = older names in the CRM.

import { readFileSync } from 'node:fs';

const SITE = 'https://www.aqualuxaruba.com';
// the full text of each service page (navigation and forms stripped)
const PAGES = JSON.parse(readFileSync(new URL('./website-pages.json', import.meta.url), 'utf8'));
const IMG = (id) => `https://static.wixstatic.com/media/${id}`;

// The price options exactly as aqualuxaruba.com lists them.
const pp = 'per_person', veh = 'per_vehicle', hr = 'per_hour', day = 'per_day', flat = 'flat_total', quote = 'quote';
const o = (option_name, price, price_unit, extra = {}) => ({ option_name, price, price_unit, ...extra });
const PRICES = {
  'awa-aruba': [
    o('Morning Charter', 2000, flat, { max_people: 6, timing: '10:30 AM – 2:30 PM (4 h)', notes: 'Price for up to 6 guests' }),
    o('Sunset Charter', 2000, flat, { max_people: 6, timing: '3:30 – 7:30 PM (4 h)', notes: 'Price for up to 6 guests' }),
    o('Full Day Charter', 3000, flat, { max_people: 6, timing: '10:30 AM – 6:30 PM or 11:30 AM – 7:30 PM (8 h)', notes: 'Price for up to 6 guests' }),
    o('Extra guest (7th to 15th)', 50, pp, { notes: 'On top of any charter, up to 15 guests in total' })
  ],
  'catamaran-tour': [
    o('Brunch Tour', 89, pp, { child_price: 56, timing: '4 hours', notes: 'Adults 12+, children 4–11' }),
    o('Afternoon Tour', 62, pp, { child_price: 43, timing: '2.5 hours', notes: 'Adults 12+, children 4–11' }),
    o('Sunset Tour', 69, pp, { child_price: 49, timing: '2 hours', notes: 'Adults 12+, children 4–11. Optional 4-course dinner after (extra)' })
  ],
  'clear-kayak': [o('Clear Kayak Shoot', 400, flat, { max_people: 2, timing: '1 hour', notes: 'One kayak, holds 2 people; pictures and videos included' })],
  'jolly-pirates': [
    o('Morning Tour', 86, pp, { child_price: 60, timing: '9:00 AM – 1:00 PM', notes: 'Adults 11+, children up to 10' }),
    o('Afternoon Tour', 67, pp, { child_price: 47, timing: '2:00 – 5:00 PM', notes: 'Adults 11+, children up to 10' }),
    o('Sunset Tour', 53, pp, { child_price: 43, timing: '5:30 – 7:30 PM', notes: 'Adults 11+, children up to 10' })
  ],
  'parasailing-tubing': [o('Parasailing', 70, pp), o('Tubing', 25, pp)],
  'private-boats': [
    o('10-Seater', 200, hr, { max_people: 10, timing: '3 to 8 hours', notes: 'Captain included' }),
    o('15-Seater', 300, hr, { max_people: 15, timing: '3 to 8 hours', notes: 'Captain included' })
  ],
  'atv-tours-rentals': [
    o('Single Seater', 130, veh, { timing: '9:00 AM – 1:00 PM or 2:30 – 6:30 PM (4 h)' }),
    o('Double Seater', 170, veh, { timing: '9:00 AM – 1:00 PM or 2:30 – 6:30 PM (4 h)' })
  ],
  'copy-of-private-jeep-tour': [o('Wariruri Tour', 105, pp, { timing: '9:00 – 10:40 AM or 4:00 – 5:40 PM', notes: 'Non-refundable' })],
  'cultural-tour': [o('Cultural Tour', 75, pp, { child_price: 45, max_people: 12, timing: '9:00 AM – 1:00 PM (4 h)' })],
  'open-safari-jeep': [
    o('6-Seater Jeep', 110, hr, { timing: '3 to 8 hours, between 6 AM and 6 PM', notes: '$60 per hour after the first 4 hours' }),
    o('9-Seater Jeep', 130, hr, { timing: '3 to 8 hours, between 6 AM and 6 PM', notes: '$70 per hour after the first 4 hours' })
  ],
  'private-jeep-tour': [o('Private Jeep Tour', 100, pp, { max_people: 8, timing: '9:00 AM – 1:00 PM (4 h)', notes: 'Children under 12 free' })],
  'utv-tours-rentals': [
    o('2-Seater', 190, veh, { timing: '9:00 AM – 1:00 PM or 2:30 – 6:30 PM (4 h)' }),
    o('3-Seater', 285, veh, { timing: '9:00 AM – 1:00 PM or 2:30 – 6:30 PM (4 h)' }),
    o('4-Seater', 380, veh, { timing: '9:00 AM – 1:00 PM or 2:30 – 6:30 PM (4 h)' }),
    o('5-Seater', 475, veh, { timing: '9:00 AM – 1:00 PM or 2:30 – 6:30 PM (4 h)' })
  ],
  'private-massage': [
    o('Swedish — 60 minutes', 120, pp), o('Swedish — 90 minutes', 170, pp),
    o('Deep Tissue — 60 minutes', 135, pp), o('Deep Tissue — 90 minutes', 155, pp),
    o('Hot Stone — 60 minutes', 135, pp), o('Hot Stone — 90 minutes', 165, pp),
    o('Facial — 60 minutes', 120, pp)
  ],
  'private-chef': [
    o('Breakfast & Brunch', 45, pp, { notes: 'Starting price' }),
    o('Lunch & Dinner', 90, pp, { notes: 'Starting price' }),
    o('BBQ Cook-out', 70, pp, { notes: 'Starting price; 3 menus to choose from' }),
    o('Paella', 50, pp, { notes: 'Starting price' }),
    o('Local Cuisine', 75, pp, { notes: 'Starting price' })
  ],
  'balloon-decorations': [o('Balloon decoration', 0, quote, { notes: 'Price on request' })],
  'floating-breakfast': [
    o('Big Breakfast', 210, flat, { max_people: 2, notes: 'Serves 2' }),
    o('Vegan Breakfast', 210, flat, { max_people: 2, notes: 'Serves 2' }),
    o('Sweet Breakfast', 210, flat, { max_people: 2, notes: 'Serves 2' }),
    o('Extra breakfast', 30, flat), o('Cold-pressed juice', 8, flat), o('Kombucha', 7, flat), o('Vegan treats', 7, flat)
  ],
  'flower-arrangements': [o('Flower arrangement', 35, flat, { notes: 'Starting price' })],
  'photography': [o('Photo / video session', 350, flat, { notes: 'Starting price' })],
  'airport-transportation': [
    o('One way', 60, flat, { notes: 'Starting price; depends on location and number of people' }),
    o('Round trip', 100, flat, { notes: 'Starting price; depends on location and number of people' })
  ],
  'car-rental': [
    o('Sedan', 50, day, { max_people: 5, notes: '$300 refundable deposit' }),
    o('SUV', 85, day, { max_people: 7, notes: '$85–100 per day, 5–7 people; $500 refundable deposit' }),
    o('11-Seater Van', 100, day, { max_people: 11, notes: '$500 refundable deposit' }),
    o('Jeep', 250, day, { max_people: 5, notes: '$500 refundable deposit' })
  ]
};

export const WEBSITE_CATALOG = [
  // ------------------------------------------------------ water activities
  {
    slug: 'awa-aruba', match: ['AWA Aruba'], aliases: ['Private Sailing Charter'],
    category: 'Water Activity', service_name: 'Private Sailing', company: 'AWA Aruba',
    image: IMG('fb7be0_8782e24037b2462d9026f9df31d2b5b9~mv2.jpg'),
    summary: 'A private luxury catamaran charter with VIP treatment: morning, sunset or full-day sailing, exploring the underwater world at your leisure.',
    included: 'Private chef (on request)\nPremium liquor\n4 underwater scooters\nOvernight stay (extra fee)',
    duration: 'Morning 10:30 AM – 2:30 PM (4 h) · Sunset 3:30 – 7:30 PM (4 h) · Full day 10:30 AM – 6:30 PM or 11:30 AM – 7:30 PM (8 h)',
    location: 'Departs from Varadero. Please arrive 30 minutes early.',
    good_to_know: 'Price is for up to 6 guests. Each extra guest is $50, up to 15 guests in total.',
    cancellation_policy: '',
    website_prices: 'Morning or Sunset charter from $2,000 · Full day from $3,000 (up to 6 guests, +$50 per extra guest, max 15)',
  },
  {
    slug: 'catamaran-tour', match: ['Catamaran Tour'], aliases: [],
    category: 'Water Activity', service_name: 'Catamaran Tour', company: 'Pelican Aruba',
    image: IMG('2a65e2_2014b84697e54c96bfa71019d8d11aaf~mv2.webp'),
    summary: 'Custom-built catamaran cruises: a brunch tour with three snorkel stops (Catalina Bay, the Antilla wreck, Malmok Reef), an afternoon snorkel sail, or a sunset cruise.',
    included: 'Brunch: professional guides, 3 stops, breakfast, lunch with champagne, open bar with mimosas, snorkel gear, Third Lung equipment\nAfternoon: 2 snorkel stops, guides, open bar, snacks, snorkel gear\nSunset: guides, open bar, snacks; optional 4-course dinner at Pelican Nest (extra)',
    duration: 'Brunch 4 h · Afternoon 2.5 h · Sunset 2 h',
    location: 'Pelican Pier. Please arrive 30 minutes early.',
    good_to_know: 'Adult price is age 12 and up, child price age 4 to 11.',
    cancellation_policy: '',
    website_prices: 'Brunch $89 adult / $56 child · Afternoon $62 / $43 · Sunset $69 / $49',
  },
  {
    slug: 'clear-kayak', match: ['Clear Kayak'], aliases: ['Clear Kayak Drone Shoot'],
    category: 'Water Activity', service_name: 'Clear Kayak Shoot', company: 'Island Cabana',
    image: IMG('2a65e2_1cea1ed37c2c4442b320b96c1c42f3f7~mv2.jpg'),
    summary: 'A one-hour paddle in a crystal-clear kayak with a professional drone photo and video shoot from above.',
    included: 'Clear kayak (holds 2 people)\nHigh-quality drone pictures\nHigh-quality videos',
    duration: '1 hour',
    location: '',
    good_to_know: 'Each kayak holds 2 people.',
    cancellation_policy: '',
    website_prices: '$400 per kayak (1 hour, up to 2 people, photos and videos included)',
  },
  {
    slug: 'jolly-pirates', match: ['Jolly Pirates'], aliases: ['Pirates Sail Boat Tour'],
    category: 'Water Activity', service_name: 'Pirate Sail Boat', company: 'Jolly Pirates',
    image: IMG('2a65e2_4a4cad3f57c04430827df9fb7ac62c19~mv2.jpg'),
    summary: 'Sailing on the 85-foot Jolly Pirates teak schooners: a morning snorkel tour with BBQ, an afternoon snorkel cruise, or a sunset cruise. Rope swing and open bar on every trip.',
    included: 'Morning: 3 snorkel stops (Malmok, Boca Catalina, SS Antilla wreck), BBQ, lunch with champagne, open bar, rope swing\nAfternoon: 2 snorkel stops, open bar, rope swing\nSunset: open bar, rope swing',
    duration: 'Morning 9 AM – 1 PM (4 h) · Afternoon 2 – 5 PM (3 h) · Sunset 5:30 – 7:30 PM (2 h)',
    location: 'Departs from Moomba Beach. Arrive 30–45 minutes early for check-in.',
    good_to_know: 'Adult price is age 11 and up, child price up to age 10.',
    cancellation_policy: '',
    website_prices: 'Morning $86 adult / $60 child · Afternoon $67 / $47 · Sunset $53 / $43',
  },
  {
    slug: 'parasailing-tubing', match: ['Parasailing & Tubing'], aliases: ['Water Sports'],
    category: 'Water Activity', service_name: 'Parasailing & Tubing', company: 'Beach Shack',
    image: IMG('fb7be0_5a672153873d4f288904cab7d5612114~mv2.webp'),
    summary: 'Parasailing high above the turquoise water, towed by a speedboat, or a tubing ride along the coast.',
    included: 'Life jackets\nSafety briefing by a professional team (15+ years of experience)',
    duration: '',
    location: '',
    good_to_know: 'Friends can stay in the boat and watch.',
    cancellation_policy: '',
    website_prices: 'Parasailing $70 per person · Tubing $25 per person',
  },
  {
    slug: 'private-boats', match: ['Private Boat'], aliases: ['Private Boat Charter'],
    category: 'Water Activity', service_name: 'Private Boats', company: 'Around Aruba Tours',
    image: IMG('fb7be0_53a46d217079440fb8a6c80b70ece19d~mv2.jpg'),
    summary: 'A private luxury boat with skipper: sightseeing, swimming, snorkeling or fishing, from the high-rise hotel area to Mangel Halto. Flexible itinerary and times.',
    included: 'Boat captain\nPick-up and drop-off (depends on area)\nSnorkel equipment\nNon-alcoholic drinks (Coke, water, iced tea)\nLife jackets',
    duration: '3 to 8 hours',
    location: '',
    good_to_know: 'Bring a hat, sunscreen, swimwear, towel and camera.\n10-seater for up to 10 guests, 15-seater for up to 15 guests.',
    cancellation_policy: '',
    website_prices: '$200 per hour (up to 10 guests) · $300 per hour (up to 15 guests)',
  },

  // ------------------------------------------------- adventures & culture
  {
    slug: 'atv-tours-rentals', match: ['ATV Tour & Rentals'], aliases: ['ATV Guided Tour'],
    category: 'Adventure', service_name: 'ATV Tour', company: 'Around Aruba Tours',
    image: IMG('2a65e2_b8c4be7fad5646958078d582d9033f71~mv2.jpeg'),
    summary: 'Off-road ATV tour to the island’s hidden gems: Natural Cave Pool, Philip’s Animal Garden, Alto Vista Chapel, Baby Natural Bridge, Bushiribana ruins, Ayo rock formations and more.',
    included: 'Pick-up and drop-off (excluding some locations)\nAdmission to Philip’s Animal Garden and feeding bag\nHelmet and bandana\nBottled water',
    duration: '4 hours: 9 AM – 1 PM or 2:30 – 6:30 PM',
    location: '',
    good_to_know: 'Drivers must be 18+ with a valid driver’s license.\nSwimming and cliff jumping at the cave pool depend on sea conditions.\nBook early in peak season.',
    cancellation_policy: '',
    website_prices: 'Single ATV $130 · Double ATV $170 (4-hour tour)',
  },
  {
    slug: 'copy-of-private-jeep-tour', match: [], aliases: [],
    category: 'Adventure', service_name: 'Horseback Riding Tour', company: 'Aruba Horse Tours',
    image: IMG('fb7be0_235dd4c9257a416781fdb9dba7d480cc~mv2.jpg'),
    summary: 'The Wariruri horseback tour along Aruba’s scenic north coast with the award-winning Rancho La Ponderosa.',
    included: 'Pick-up and drop-off (depending on location)\nWater\nHelmet',
    duration: '1 h 40 min: 9:00 – 10:40 AM or 4:00 – 5:40 PM',
    location: '',
    good_to_know: 'Rider weight limit 225 lb.',
    cancellation_policy: 'Non-refundable. All sales are final.',
    website_prices: '$105 per person',
    options: [
      { option_name: 'Horseback Riding Tour', price: 105, price_unit: 'per_person', timing: '9:00 AM or 4:00 PM' },
    ],
  },
  {
    slug: 'cultural-tour', match: [], aliases: [],
    category: 'Adventure', service_name: 'Cultural Tour', company: 'Kini Kini Tours',
    image: IMG('2a65e2_349db11642214ef4a07f8e58c0362d61~mv2.jpg'),
    summary: 'A culture island tour featuring Aruba’s best art, culture and beaches: San Nicolas street murals, Colorado Point Lighthouse, Mangel Halto and Baby Beach.',
    included: 'Pick-up and drop-off (excluding some locations)\nAir-conditioned minivan\nLocal guide\nBottled water',
    duration: '4 hours, 9 AM – 1 PM',
    location: '',
    good_to_know: 'Maximum 12 guests per tour.',
    cancellation_policy: '',
    website_prices: '$75 adult · $45 child',
    options: [
      { option_name: 'Cultural Tour', price: 75, child_price: 45, price_unit: 'per_person', max_people: 12, timing: '9 AM – 1 PM' },
    ],
  },
  {
    slug: 'open-safari-jeep', match: ['Open-Air Safari'], aliases: ['Open-Air Safari'],
    category: 'Adventure', service_name: 'Open-Air Safari Jeep Tour', company: 'Around Aruba Tours',
    image: IMG('2a65e2_c75fb74cd8d94f3e99e01dd2efed99d0~mv2.jpg'),
    summary: 'A private open-air safari jeep with driver/guide: Natural Bridge, Alto Vista Chapel, Philip’s Animal Garden and more. Customize the route.',
    included: 'Pick-up and drop-off (excluding some locations)\nDriver / guide\nNon-alcoholic drinks\nSnorkel gear on request',
    duration: '3 to 8 hours, between 6 AM and 6 PM',
    location: '',
    good_to_know: 'Price is per jeep.\nAfter the first 4 hours the hourly rate drops to $60 (6-seater) or $70 (9-seater).',
    cancellation_policy: '',
    website_prices: '6-seater $110 per hour · 9-seater $130 per hour (after 4 h: $60 / $70 per hour)',
  },
  {
    slug: 'private-jeep-tour', match: ['Private Jeep Tour'], aliases: [],
    category: 'Adventure', service_name: 'Private Jeep Tour', company: 'Around Aruba Tours',
    image: IMG('fb7be0_423f2e58738446e780954c15c952eebb~mv2.jpg'),
    summary: 'A private jeep tour: Boca Catalina, Alto Vista Chapel, Baby Natural Bridge, Bushiribana ruins, Cave Pool, Noordkaap, Black Stone Beach and a secret spot only on this tour.',
    included: 'Pick-up and drop-off\nDriver / guide\nWater\nSnorkel gear',
    duration: '4 hours, 9 AM – 1 PM',
    location: '',
    good_to_know: 'Children under 12 go free.\nMaximum 8 guests.',
    cancellation_policy: '',
    website_prices: '$100 per adult · under 12 free',
  },
  {
    slug: 'utv-tours-rentals', match: ['UTV Tours & Rentals'], aliases: ['UTV Guided Tour'],
    category: 'Adventure', service_name: 'UTV Tour', company: 'Around Aruba Tours',
    image: IMG('2a65e2_95cfea1dc7ed4b868cd6e9938d41b8cb~mv2.jpeg'),
    summary: 'Off-road UTV tour to the island’s hidden gems: Natural Cave Pool, Alto Vista Chapel, Philip’s Animal Garden and 8 more attractions. 2- to 5-seat vehicles.',
    included: 'Pick-up and drop-off (excluding some locations)\nAdmission to Philip’s Animal Garden',
    duration: '4 hours: 9 AM – 1 PM or 2:30 – 6:30 PM',
    location: '',
    good_to_know: 'Drivers must be 18+ with a valid driver’s license.\nBook early in peak season.',
    cancellation_policy: '',
    website_prices: '2-seater $190 · 3-seater $285 · 4-seater $380 · 5-seater $475 (4 hours)',
  },

  // ------------------------------------------------------------ relaxation
  {
    slug: 'private-massage', match: ['Private Massage'], aliases: ['Private In-Villa Massage'],
    category: 'Relaxation', service_name: 'Private Massage', company: 'My Lovely Body',
    image: IMG('2a65e2_e9ad95fa80f74fc8b2de182d745da714~mv2.jpg'),
    summary: 'A professional massage therapist comes to your villa, hotel room or any location you choose. Swedish, deep tissue, hot stone or a facial.',
    included: 'Professionals come to you\nThey bring all the supplies needed',
    duration: '60 or 90 minutes',
    location: 'At the guest’s hotel, Airbnb, rental or any location they choose.',
    good_to_know: 'Several people can be treated at the same time (they have a team).',
    cancellation_policy: '',
    website_prices: 'Swedish 60 min $120 / 90 min $170 · Deep Tissue 60 min $135 / 90 min $155 · Hot Stone 60 min $135 / 90 min $165 · Facial 60 min $120',
  },

  // ------------------------------------------------------- private cuisine
  {
    slug: 'private-chef', match: ['Private Chef'], aliases: ['Private Chef Buffet (Dining Memories)', 'Private Cookout & Paella (Flo Chef)'],
    category: 'Private Cuisine', service_name: 'Private Chef', company: 'Green Fish & Vincent',
    image: IMG('2a65e2_b37338da93ae4b9b997815a4e0609a2d~mv2.jpg'),
    summary: 'A private chef at your hotel, Airbnb or rental: breakfast & brunch, lunch & dinner, a BBQ cook-out (3 menus), a paella night or local cuisine.',
    included: 'Professionals come to you with all supplies\nPlating and serving\nAdd-ons: bottomless mimosas, wine/prosecco, wine pairing, cocktail bartender, table decoration, cake, tiramisu, passion-fruit cheesecake',
    duration: '',
    location: 'At the guest’s hotel, Airbnb or rental.',
    good_to_know: 'Guest numbers can be changed up to 48 hours before; after that the last number given counts.',
    cancellation_policy: '72 hours or more before: full refund. Less than 72 hours: no refund.',
    website_prices: 'Breakfast & Brunch from $45 pp · Lunch & Dinner from $90 pp · BBQ Cook-out from $70 pp · Paella from $50 pp · Local Cuisine from $75 pp',
  },

  // --------------------------------------------------------------- moments
  {
    slug: 'balloon-decorations', match: ['Balloon Decoration'], aliases: ['Balloon Decoration'],
    category: 'Moments', service_name: 'Balloon Decorations', company: 'Express Your Feelings',
    image: IMG('fb7be0_15d191d20fe54e3da8072f829e62f54d~mv2.jpg'),
    summary: 'Custom balloon decorations for birthdays, weddings or romantic dates, set up at the guest’s Airbnb.',
    included: 'Custom design and set-up',
    duration: '',
    location: 'At the guest’s Airbnb.',
    good_to_know: 'Can be set up before arrival or anytime during the stay.\nBook as early as possible.',
    cancellation_policy: '',
    website_prices: 'Price on request',
  },
  {
    slug: 'floating-breakfast', match: ['Floating Breakfast'], aliases: [],
    category: 'Moments', service_name: 'Floating Breakfast', company: 'Eduardo’s Beach Shack',
    image: IMG('2a65e2_b171bab9812d48c68924bba523e62a7e~mv2.jpg'),
    summary: 'A floating breakfast in your private pool, for two: Big (eggs, potatoes, bacon, sausage), Vegan (vegan omelette and sausage) or Sweet (waffle and fruit).',
    included: '1 bottle of prosecco\n2 orange juices\nPineapple bowl with seasonal fruit\n2 breakfasts\n1 treat plate\nExtras: extra breakfast $30, cold-pressed juice $8, kombucha $7, vegan treats $7',
    duration: '',
    location: 'The guest’s private pool.',
    good_to_know: 'Not available for public pools.',
    cancellation_policy: '',
    website_prices: '$210 for 2 people (Big, Vegan or Sweet)',
  },
  {
    slug: 'flower-arrangements', match: ['Flower Arrangements'], aliases: [],
    category: 'Moments', service_name: 'Flower Arrangements', company: 'Flortiek',
    image: IMG('2a65e2_d8e5b86109a742288acf4da10e6d74ba~mv2.jpg'),
    summary: 'Personalized floral designs for birthdays, weddings or romantic dates, delivered to the guest’s Airbnb.',
    included: 'Custom arrangement from any available flowers and styles\nDelivery',
    duration: '',
    location: 'Delivered to the guest’s Airbnb.',
    good_to_know: 'Book as early as possible, especially around holidays (Mother’s Day, Valentine’s Day).',
    cancellation_policy: '',
    website_prices: 'From $35',
  },
  {
    slug: 'photography', match: [], aliases: [],
    category: 'Moments', service_name: 'Photographer & Videographer', company: 'Jansen Studio',
    image: IMG('2a65e2_c571fee1348c4d60800ff478965e720a~mv2.jpg'),
    summary: 'Professional photography and videography for any occasion: underwater shoots, maternity sessions, weddings and special events.',
    included: 'Professional photographer or videographer',
    duration: '',
    location: 'Guest’s choice, or ask for recommendations.',
    good_to_know: '',
    cancellation_policy: '',
    website_prices: 'From $350',
    options: [
      { option_name: 'Photo / video session', price: 350, price_unit: 'flat_total', notes: 'Starting price' },
    ],
  },

  // ------------------------------------------------------ transport & more
  {
    slug: 'airport-transportation', match: ['Airport Transportation'], aliases: ['Airport Transportation'],
    category: 'Transportation', service_name: 'Private Airport Transportation', company: 'E.C. Tours & Transfers',
    image: IMG('2a65e2_993d3eeb1cd043729075918f1ebec0cc~mv2.jpg'),
    summary: 'Private airport drop-off and pick-up in high-end vehicles. The driver greets guests at the airport and helps with luggage.',
    included: 'Professional driver\nHelp with luggage',
    duration: '',
    location: 'Aruba airport (AUA).',
    good_to_know: 'Price depends on location and number of people.\nGrocery stop on the way: +$20, driver waits 30 minutes.',
    cancellation_policy: '24 hours or more before: full refund. Less than 24 hours: no refund.',
    website_prices: 'One way from $60 · Round trip from $100',
  },
  {
    slug: 'car-rental', match: ['Car Rental'], aliases: [],
    category: 'Transportation', service_name: 'Car Rental', company: '',
    image: IMG('2a65e2_d87bb3065cca44cba1162a76440e7c3f~mv2.jpg'),
    summary: 'Rental cars: sedan, SUV, 11-seater van or jeep, with airport pick-up and drop-off.',
    included: 'Airport pick-up and drop-off\nNo mileage limit',
    duration: 'Per day',
    location: 'They pick guests up at the airport and bring them to the rental company.',
    good_to_know: 'Drivers must be 21 or older.\nReturn the car with the same amount of gas.\nRefundable deposit: sedan $300; SUV, van and jeep $500.',
    cancellation_policy: '',
    website_prices: 'Sedan from $50/day (5 seats) · SUV $85–100/day (5–7 seats) · 11-seater van $100/day · Jeep $250/day',
  },
].map((s) => ({ ...s, options: PRICES[s.slug] || [], page_url: `${SITE}/${s.slug}`, website_text: PAGES[s.slug] || '' }));
