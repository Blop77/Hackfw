// SAMPLE DATA used when no QLOO_API_KEY is set, so the app can be run and tested offline.
//
// None of this comes from Qloo. Landmarks are real public places in Pune with approximate
// coordinates. Cafés and food spots are made-up "Sample ..." entries, so the demo never
// presents a real business as a Qloo recommendation. Affinity scores are invented.

export const DEMO_CENTER = { lat: 18.5204, lon: 73.8567, label: 'Pune' };

// `keywords` drive the fake affinity: tastes that mention a keyword boost that place.
export const DEMO_PLACES = [
  { id: 'demo-shaniwar-wada', name: 'Shaniwar Wada', category: 'sight', lat: 18.5195, lon: 73.8553, base: 0.62, keywords: ['history', 'fort', 'bajirao', 'marathi', 'documentary'], tags: ['Historic site', 'Fort'] },
  { id: 'demo-aga-khan', name: 'Aga Khan Palace', category: 'sight', lat: 18.5524, lon: 73.9015, base: 0.58, keywords: ['history', 'gandhi', 'museum', 'biography'], tags: ['Museum', 'Garden'] },
  { id: 'demo-kelkar', name: 'Raja Dinkar Kelkar Museum', category: 'sight', lat: 18.5106, lon: 73.8547, base: 0.55, keywords: ['museum', 'art', 'history', 'craft'], tags: ['Museum'] },
  { id: 'demo-vetal', name: 'Vetal Tekdi (Vetal Hill)', category: 'sight', lat: 18.5266, lon: 73.8216, base: 0.6, keywords: ['nature', 'hiking', 'ghibli', 'miyazaki', 'birds', 'outdoors', 'lofi'], tags: ['Hill', 'Nature trail'] },
  { id: 'demo-pashan', name: 'Pashan Lake', category: 'sight', lat: 18.5362, lon: 73.7837, base: 0.57, keywords: ['nature', 'birds', 'lake', 'ghibli', 'calm', 'lofi'], tags: ['Lake', 'Birdwatching'] },
  { id: 'demo-okayama', name: 'Pune Okayama Friendship Garden', category: 'sight', lat: 18.493, lon: 73.837, base: 0.56, keywords: ['japan', 'japanese', 'anime', 'ghibli', 'garden', 'calm', 'zen'], tags: ['Japanese garden'] },
  { id: 'demo-parvati', name: 'Parvati Hill', category: 'sight', lat: 18.497, lon: 73.8466, base: 0.54, keywords: ['temple', 'view', 'history', 'hiking'], tags: ['Hill temple', 'Viewpoint'] },
  { id: 'demo-empress', name: 'Empress Garden', category: 'sight', lat: 18.5068, lon: 73.8997, base: 0.5, keywords: ['garden', 'nature', 'calm'], tags: ['Botanical garden'] },
  { id: 'demo-bund', name: 'Bund Garden', category: 'sight', lat: 18.535, lon: 73.878, base: 0.48, keywords: ['river', 'evening', 'calm'], tags: ['Riverside park'] },
  { id: 'demo-cafe-fc', name: 'Sample indie café (FC Road)', category: 'cafe', lat: 18.5236, lon: 73.841, base: 0.6, keywords: ['coffee', 'indie', 'lofi', 'jazz', 'books', 'prateek kuhad', 'taylor swift'], tags: ['Café', 'Live music'] },
  { id: 'demo-cafe-baner', name: 'Sample coffee roastery (Baner)', category: 'cafe', lat: 18.559, lon: 73.786, base: 0.57, keywords: ['coffee', 'espresso', 'specialty', 'minimal'], tags: ['Coffee roaster'] },
  { id: 'demo-irani-camp', name: 'Sample Irani café (Camp)', category: 'cafe', lat: 18.519, lon: 73.876, base: 0.55, keywords: ['chai', 'bun maska', 'old school', 'retro', 'bollywood', 'nostalgia'], tags: ['Irani café', 'Bakery'] },
  { id: 'demo-tea-pashan', name: 'Sample tea stall (Pashan)', category: 'cafe', lat: 18.538, lon: 73.795, base: 0.5, keywords: ['chai', 'tea', 'street'], tags: ['Tea stall'] },
  { id: 'demo-misal', name: 'Sample misal house (Sadashiv Peth)', category: 'food', lat: 18.51, lon: 73.848, base: 0.62, keywords: ['misal', 'spicy', 'maharashtrian', 'marathi', 'street food'], tags: ['Maharashtrian', 'Breakfast'] },
  { id: 'demo-dosa', name: 'Sample South Indian tiffin (Deccan)', category: 'food', lat: 18.517, lon: 73.841, base: 0.6, keywords: ['dosa', 'idli', 'south indian', 'filter coffee', 'tamil', 'rajinikanth'], tags: ['South Indian'] },
  { id: 'demo-bakery-camp', name: 'Sample old bakery (Camp)', category: 'food', lat: 18.515, lon: 73.878, base: 0.52, keywords: ['bakery', 'cake', 'sweet', 'dessert', 'retro'], tags: ['Bakery'] },
  { id: 'demo-ramen-kp', name: 'Sample ramen bar (Koregaon Park)', category: 'food', lat: 18.539, lon: 73.893, base: 0.5, keywords: ['ramen', 'japanese', 'anime', 'ghibli', 'naruto', 'sushi'], tags: ['Japanese', 'Noodles'] },
];

/** Invented affinity: a base score plus a bonus for each taste that mentions a keyword. */
export function demoAffinity(place, tasteNames) {
  const text = tasteNames.join(' ').toLowerCase();
  const hits = place.keywords.filter((k) => text.includes(k)).length;
  return Math.min(0.99, place.base + 0.12 * hits);
}
