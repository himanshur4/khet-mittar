/**
 * Officially renamed districts. GeoNames (our geocoder) often still uses the old name while
 * Agmarknet uses the new one (observed: geocoder "Ahmednagar", Agmarknet "Ahilyanagar"), so
 * district matching treats every name in a group as the same district.
 * Scoped by state because old names repeat elsewhere (Aurangabad is also a district in Bihar).
 */
export const DISTRICT_RENAMES: Array<{ state: string; names: string[] }> = [
  { state: "Maharashtra", names: ["Ahilyanagar", "Ahmednagar", "Ahmadnagar"] },
  // Agmarknet spells it "Chattrapati" (seen in live data, 1 Nov 2026).
  {
    state: "Maharashtra",
    names: ["Chhatrapati Sambhajinagar", "Chattrapati Sambhajinagar", "Aurangabad"],
  },
  { state: "Maharashtra", names: ["Dharashiv", "Osmanabad"] },
  { state: "Haryana", names: ["Gurugram", "Gurgaon"] },
  { state: "Haryana", names: ["Nuh", "Mewat"] },
  { state: "Uttar Pradesh", names: ["Prayagraj", "Allahabad"] },
  { state: "Uttar Pradesh", names: ["Ayodhya", "Faizabad"] },
  { state: "Madhya Pradesh", names: ["Narmadapuram", "Hoshangabad"] },
];
