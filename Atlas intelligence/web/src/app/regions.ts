import type { LngLat } from '../geo/coordinates/lngLat'

export type RegionSource = 'procedural' | 'osm'

export interface Region {
  id: string
  name: string
  origin: LngLat
  seed: string
  source: RegionSource
  /** true only for the engine demo: a made-up city with made-up traffic. Real regions never simulate data. */
  simulation: boolean
  demo?: boolean
  /** IANA zone, used for time-of-day analytics */
  timezone: string
  /** UTC offset hours used by analysers that only need a coarse local hour */
  utcOffsetHours: number
}

/** Regions mirror server/app/regions.py. Every region is real data; nothing is made up. */
export const REGIONS: Record<string, Region> = {
  india: { id: 'india', name: 'India', origin: { lng: 77.2167, lat: 28.6315 }, seed: 'india-2026', source: 'osm', simulation: false, timezone: 'Asia/Kolkata', utcOffsetHours: 5.5 },
}
/** Older links said ?region=ncr; it is the same real map. */
const ALIASES: Record<string, string> = { ncr: 'india' }

/** Every state and union territory, by its capital or largest city, so a reader picks one and is there. */
export const PLACES: Array<{ id: string; name: string; hi: string; lng: number; lat: number }> = [
  { id: 'delhi', name: 'Delhi', hi: 'दिल्ली', lng: 77.2167, lat: 28.6315 },
  { id: 'andhra', name: 'Andhra Pradesh · Amaravati', hi: 'आंध्र प्रदेश · अमरावती', lng: 80.5150, lat: 16.5062 },
  { id: 'arunachal', name: 'Arunachal Pradesh · Itanagar', hi: 'अरुणाचल प्रदेश · ईटानगर', lng: 93.6166, lat: 27.0844 },
  { id: 'assam', name: 'Assam · Guwahati', hi: 'असम · गुवाहाटी', lng: 91.7362, lat: 26.1445 },
  { id: 'bihar', name: 'Bihar · Patna', hi: 'बिहार · पटना', lng: 85.1376, lat: 25.5941 },
  { id: 'chhattisgarh', name: 'Chhattisgarh · Raipur', hi: 'छत्तीसगढ़ · रायपुर', lng: 81.6296, lat: 21.2514 },
  { id: 'goa', name: 'Goa · Panaji', hi: 'गोवा · पणजी', lng: 73.8278, lat: 15.4909 },
  { id: 'gujarat', name: 'Gujarat · Ahmedabad', hi: 'गुजरात · अहमदाबाद', lng: 72.5714, lat: 23.0225 },
  { id: 'haryana', name: 'Haryana · Gurugram', hi: 'हरियाणा · गुरुग्राम', lng: 77.0266, lat: 28.4595 },
  { id: 'himachal', name: 'Himachal Pradesh · Shimla', hi: 'हिमाचल प्रदेश · शिमला', lng: 77.1734, lat: 31.1048 },
  { id: 'jharkhand', name: 'Jharkhand · Ranchi', hi: 'झारखंड · राँची', lng: 85.3096, lat: 23.3441 },
  { id: 'karnataka', name: 'Karnataka · Bengaluru', hi: 'कर्नाटक · बेंगलुरु', lng: 77.5946, lat: 12.9716 },
  { id: 'kerala', name: 'Kerala · Thiruvananthapuram', hi: 'केरल · तिरुवनंतपुरम', lng: 76.9366, lat: 8.5241 },
  { id: 'mp', name: 'Madhya Pradesh · Bhopal', hi: 'मध्य प्रदेश · भोपाल', lng: 77.4126, lat: 23.2599 },
  { id: 'maharashtra', name: 'Maharashtra · Mumbai', hi: 'महाराष्ट्र · मुंबई', lng: 72.8777, lat: 19.0760 },
  { id: 'manipur', name: 'Manipur · Imphal', hi: 'मणिपुर · इंफाल', lng: 93.9368, lat: 24.8170 },
  { id: 'meghalaya', name: 'Meghalaya · Shillong', hi: 'मेघालय · शिलांग', lng: 91.8933, lat: 25.5788 },
  { id: 'mizoram', name: 'Mizoram · Aizawl', hi: 'मिज़ोरम · आइज़ोल', lng: 92.7173, lat: 23.7271 },
  { id: 'nagaland', name: 'Nagaland · Kohima', hi: 'नागालैंड · कोहिमा', lng: 94.1086, lat: 25.6751 },
  { id: 'odisha', name: 'Odisha · Bhubaneswar', hi: 'ओडिशा · भुवनेश्वर', lng: 85.8245, lat: 20.2961 },
  { id: 'punjab', name: 'Punjab · Chandigarh', hi: 'पंजाब · चंडीगढ़', lng: 76.7794, lat: 30.7333 },
  { id: 'rajasthan', name: 'Rajasthan · Jaipur', hi: 'राजस्थान · जयपुर', lng: 75.7873, lat: 26.9124 },
  { id: 'sikkim', name: 'Sikkim · Gangtok', hi: 'सिक्किम · गंगटोक', lng: 88.6065, lat: 27.3314 },
  { id: 'tamilnadu', name: 'Tamil Nadu · Chennai', hi: 'तमिलनाडु · चेन्नई', lng: 80.2707, lat: 13.0827 },
  { id: 'telangana', name: 'Telangana · Hyderabad', hi: 'तेलंगाना · हैदराबाद', lng: 78.4867, lat: 17.3850 },
  { id: 'tripura', name: 'Tripura · Agartala', hi: 'त्रिपुरा · अगरतला', lng: 91.2868, lat: 23.8315 },
  { id: 'up', name: 'Uttar Pradesh · Lucknow', hi: 'उत्तर प्रदेश · लखनऊ', lng: 80.9462, lat: 26.8467 },
  { id: 'uttarakhand', name: 'Uttarakhand · Dehradun', hi: 'उत्तराखंड · देहरादून', lng: 78.0322, lat: 30.3165 },
  { id: 'bengal', name: 'West Bengal · Kolkata', hi: 'पश्चिम बंगाल · कोलकाता', lng: 88.3639, lat: 22.5726 },
  { id: 'andaman', name: 'Andaman & Nicobar · Port Blair', hi: 'अंडमान-निकोबार · पोर्ट ब्लेयर', lng: 92.7265, lat: 11.6234 },
  { id: 'chandigarh', name: 'Chandigarh', hi: 'चंडीगढ़', lng: 76.7794, lat: 30.7333 },
  { id: 'jk', name: 'Jammu & Kashmir · Srinagar', hi: 'जम्मू-कश्मीर · श्रीनगर', lng: 74.7973, lat: 34.0837 },
  { id: 'ladakh', name: 'Ladakh · Leh', hi: 'लद्दाख · लेह', lng: 77.5771, lat: 34.1526 },
  { id: 'lakshadweep', name: 'Lakshadweep · Kavaratti', hi: 'लक्षद्वीप · कवरत्ती', lng: 72.6369, lat: 10.5593 },
  { id: 'puducherry', name: 'Puducherry', hi: 'पुडुचेरी', lng: 79.8083, lat: 11.9416 },
  { id: 'dnhdd', name: 'Dadra & Nagar Haveli and Daman & Diu · Daman', hi: 'दादरा-नगर हवेली और दमन-दीव · दमन', lng: 72.8328, lat: 20.3974 },
]

/** Build-time override (VITE_DEFAULT_REGION) lets a static demo build start on the procedural city. */
export const DEFAULT_REGION: string = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEFAULT_REGION as string | undefined) && REGIONS[(import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEFAULT_REGION as string] ? ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEFAULT_REGION as string) : 'india'

/** The region from the URL. `?lng&lat` (or `?place=<id>`) re-centre the map's frame anywhere, so all of India is one region. */
export function regionFromSearch(search: string): Region {
  const p = new URLSearchParams(search)
  const raw = p.get('region') ?? DEFAULT_REGION
  const id = ALIASES[raw] ?? raw
  const base = REGIONS[id] ?? REGIONS[DEFAULT_REGION]
  const place = p.get('place') && PLACES.find((c) => c.id === p.get('place'))
  const lng = Number(p.get('lng')), lat = Number(p.get('lat'))
  if (place) return { ...base, origin: { lng: place.lng, lat: place.lat } }
  if (Number.isFinite(lng) && Number.isFinite(lat) && p.has('lng') && p.has('lat') && Math.abs(lat) <= 85) return { ...base, origin: { lng, lat } }
  return base
}
