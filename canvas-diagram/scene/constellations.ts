/**
 * The twelve constellations of the zodiac, as stick figures — the stars a
 * ZodiacRing can draw in its band, so the ring is the actual sky and not
 * only twelve names evenly spaced.
 *
 * Positions are ecliptic longitude and latitude in degrees, J2000, which is
 * the frame a ring drawn about the ecliptic wants: longitude *is* the angle
 * round the ring, and latitude is how far off the ecliptic a star sits, to
 * be squeezed into whatever radial room the band has. They were converted
 * from the catalogue's own right ascension and declination once, here,
 * rather than every frame in the browser.
 *
 * Note what this data makes visible, which is the point of drawing it: the
 * constellation Aries does not begin at 0° — the *sign* Aries does. The two
 * shared a starting point somewhere around the second century and have been
 * drifting apart ever since at about 50″ a year (see PRECESSION_DEG_PER_DAY,
 * and `ZodiacConstellations.lonOffset`, which is how a figure with a clock
 * on it can show that drift happening). A ring that draws both at once is
 * saying so.
 *
 * Star positions and the stick figures are from d3-celestial
 * (github.com/ofrohn/d3-celestial), whose own data is derived from the
 * Hipparcos catalogue:
 *
 *   Copyright (c) 2015, Olaf Frohn. All rights reserved.
 *   Redistributed under the BSD 3-Clause License; see the project's LICENSE
 *   for the full text and disclaimer.
 */

/** One constellation: its stars, and the lines drawn between them. */
export interface ConstellationFigure {
  /** the IAU three-letter abbreviation */
  code: string;
  name: string;
  /** the name the sign of the same name carries in Hebrew */
  nameHe: string;
  /**
   * `[ecliptic longitude °, ecliptic latitude °, visual magnitude]`, J2000,
   * with the star's proper name where it has one and is bright enough to be
   * one anybody steers by — Aldebaran, Regulus, Spica, Antares and the rest.
   * A drawing decides for itself which of those are worth writing (see
   * `ZodiacConstellations.nameStarsBrighterThan`); the data only says which
   * star is which.
   */
  stars: readonly (readonly [number, number, number] | readonly [number, number, number, string])[];
  /** the stick figure, as runs of indexes into `stars` */
  paths: readonly (readonly number[])[];
}

/**
 * General precession in ecliptic longitude: 50.29″ a year, as degrees per
 * day. Add `PRECESSION_DEG_PER_DAY * (days since J2000)` to a figure's
 * longitudes to put the stars where they stand at that date rather than
 * where they stood in 2000 — the same drift that has carried every
 * constellation a whole sign away from the sign named after it.
 */
export const PRECESSION_DEG_PER_DAY = 50.290966 / 3600 / 365.25;

export const ZODIAC_FIGURES: readonly ConstellationFigure[] = [
  {
    code: 'Ari',
    name: 'Aries',
    nameHe: 'טלה',
    stars: [
      [48.2, 10.45, 3.6],
      [37.66, 9.97, 2, 'Hamal'],
      [33.97, 8.49, 2.6, 'Sheratan'],
      [33.18, 7.16, 3.9],
    ],
    paths: [
      [0, 1, 2, 3],
    ],
  },
  {
    code: 'Tau',
    name: 'Taurus',
    nameHe: 'שור',
    stars: [
      [84.78, -2.2, 3],
      [69.79, -5.47, 0.9, 'Aldebaran'],
      [67.96, -5.84, 3.4],
      [65.81, -5.73, 3.6],
      [66.87, -3.97, 3.8],
      [68.47, -2.57, 3.5],
      [82.57, 5.39, 1.6, 'Elnath'],
      [60.63, -7.96, 3.4],
      [51.91, -8.8, 3.7],
      [59.92, -14.45, 3.9],
      [51.16, -9.33, 3.6],
      [51.95, -18.44, 4.3],
    ],
    paths: [
      [0, 1, 2, 3, 4, 5, 6],
      [3, 7, 8, 9],
      [8, 10, 11],
    ],
  },
  {
    code: 'Gem',
    name: 'Gemini',
    nameHe: 'תאומים',
    stars: [
      [93.44, -0.89, 3.3],
      [95.3, -0.82, 2.9],
      [99.94, 2.07, 3.1],
      [105.44, 7.75, 4.4],
      [110.24, 10.1, 1.6, 'Castor'],
      [113.22, 6.68, 1.2, 'Pollux'],
      [111.34, 5.22, 4.1],
      [108.52, -0.18, 3.5],
      [104.99, -2.04, 4],
      [99.1, -6.74, 1.9, 'Alhena'],
      [101.21, -10.1, 3.4],
      [108.78, -5.64, 3.6],
    ],
    paths: [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [7, 11],
    ],
  },
  {
    code: 'Cnc',
    name: 'Cancer',
    nameHe: 'סרטן',
    stars: [
      [133.64, -5.08, 4.3],
      [128.72, 0.08, 3.9],
      [127.54, 3.19, 4.7],
      [126.34, 10.43, 4],
      [124.26, -10.29, 3.5],
    ],
    paths: [
      [0, 1, 2, 3],
      [1, 4],
    ],
  },
  {
    code: 'Leo',
    name: 'Leo',
    nameHe: 'אריה',
    stars: [
      [149.83, 0.46, 1.4, 'Regulus'],
      [147.91, 4.87, 3.5],
      [149.61, 8.81, 2, 'Algieba'],
      [161.32, 14.33, 2.6, 'Zosma'],
      [171.62, 12.27, 2.1, 'Denebola'],
      [163.42, 9.67, 3.3],
      [147.57, 11.87, 3.4],
      [141.43, 12.35, 3.9],
      [140.7, 9.72, 3],
    ],
    paths: [
      [0, 1, 2, 3, 4, 5, 0],
      [2, 6, 7, 8],
    ],
  },
  {
    code: 'Vir',
    name: 'Virgo',
    nameHe: 'בתולה',
    stars: [
      [174.16, 4.59, 4],
      [177.16, 0.69, 3.6],
      [184.83, 1.37, 3.9],
      [190.14, 2.79, 2.7],
      [198.24, 1.74, 4.4],
      [203.84, -2.05, 1, 'Spica'],
      [213.8, 7.2, 4.1],
      [220.13, 9.67, 3.9],
      [189.94, 16.21, 2.9],
      [191.46, 8.61, 3.4],
      [202.13, 8.64, 3.4],
      [207.75, 13.06, 4.2],
      [218.52, 17.1, 3.7],
    ],
    paths: [
      [0, 1, 2, 3, 4, 5, 6, 7],
      [8, 9, 3],
      [4, 10, 11, 12],
    ],
  },
  {
    code: 'Lib',
    name: 'Libra',
    nameHe: 'מאזניים',
    stars: [
      [230.69, -7.64, 3.2],
      [225.08, 0.33, 2.8],
      [229.37, 8.5, 2.6, 'Zubeneschamali'],
      [235.14, 4.39, 3.9],
      [238.61, -8.51, 3.6],
      [239.35, -10.02, 3.7],
    ],
    paths: [
      [0, 1, 2, 3, 4, 5],
      [1, 3],
    ],
  },
  {
    code: 'Sco',
    name: 'Scorpius',
    nameHe: 'עקרב',
    stars: [
      [242.94, -5.48, 2.9],
      [242.57, -1.99, 2.3, 'Dschubba'],
      [243.19, 1.01, 2.6, 'Acrab'],
      [247.8, -4.04, 2.9],
      [249.76, -4.57, 1.1, 'Antares'],
      [251.46, -6.12, 2.8],
      [255.34, -11.74, 2.3, 'Larawag'],
      [256.16, -15.42, 3],
      [257.24, -19.64, 3.6],
      [260.74, -20.18, 3.3],
      [265.6, -19.65, 1.9, 'Sargas'],
      [267.52, -16.71, 3],
      [266.47, -15.64, 2.4, 'Mula'],
      [264.59, -13.79, 1.6, 'Shaula'],
    ],
    paths: [
      [0, 1, 2],
      [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    ],
  },
  {
    code: 'Sgr',
    name: 'Sagittarius',
    nameHe: 'קשת',
    stars: [
      [273.63, -13.38, 3.1],
      [275.08, -11.05, 1.8, 'Kaus Australis'],
      [274.58, -6.47, 2.7],
      [276.32, -2.14, 2.8],
      [273.21, 2.34, 3.8],
      [285.78, -22.14, 4],
      [286.64, -18.38, 4],
      [283.64, -7.18, 2.6, 'Ascella'],
      [280.18, -3.95, 3.2],
      [292.56, -20.66, 4.1],
      [294.87, -14.39, 4.4],
      [295.85, -5.42, 4.7],
      [291.85, -3.26, 4.6],
      [289.34, -2.49, 5],
      [287.04, -2.93, 4.9],
      [282.39, -3.45, 2, 'Nunki'],
      [271.26, -6.99, 3],
      [284.83, -5.09, 3.3],
      [284.99, 0.86, 3.8],
      [286.25, 1.44, 2.9],
      [288.35, 3.26, 4.9],
      [289.45, 4.22, 3.9],
      [289.73, 6.1, 4.5],
      [283.45, 1.66, 3.5],
      [282.47, 0.11, 4.9],
    ],
    paths: [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 3],
      [9, 10, 11, 12, 13, 14, 15, 8, 2, 16, 1, 7, 17, 15, 18, 19, 20, 21, 22],
      [18, 23, 24, 15],
    ],
  },
  {
    code: 'Cap',
    name: 'Capricornus',
    nameHe: 'גדי',
    stars: [
      [303.77, 6.99, 4.3],
      [304.05, 4.59, 3],
      [305.17, 1.2, 4.8],
      [307.16, -7.03, 4.1],
      [307.96, -8.96, 4.1],
      [316.94, -6.99, 3.8],
      [323.54, -2.6, 2.9],
      [321.79, -2.56, 3.7],
      [317.68, -1.37, 4.3],
      [313.84, -0.59, 4.1],
    ],
    paths: [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0],
    ],
  },
  {
    code: 'Aqr',
    name: 'Aquarius',
    nameHe: 'דלי',
    stars: [
      [311.72, 8.08, 3.8],
      [313.06, 8.24, 4.7],
      [323.4, 8.61, 2.9],
      [333.35, 10.66, 3],
      [336.71, 8.24, 3.9],
      [338.91, 8.85, 3.6],
      [340.4, 8.15, 4],
      [341.58, -0.39, 3.7],
      [346.73, -4.28, 4.4],
      [340.02, -14.49, 3.7],
      [328.72, -2.08, 4.3],
      [333.26, 2.71, 4.2],
      [338.6, 10.47, 4.8],
      [343.46, -14.79, 4],
      [348.61, -14.51, 4.8],
    ],
    paths: [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [2, 10],
      [3, 11],
      [5, 12],
      [13, 8, 14],
    ],
  },
  {
    code: 'Psc',
    name: 'Pisces',
    nameHe: 'דגים',
    stars: [
      [26.46, 15.5, 4.7],
      [28.32, 20.74, 4.5],
      [28.79, 17.47, 4.7],
      [24.53, 12.44, 4.7],
      [26.82, 5.38, 3.6],
      [27.74, -1.62, 4.3],
      [29.38, -9.06, 3.8],
      [27.52, -7.92, 4.6],
      [25.51, -4.69, 4.5],
      [23.14, -3.06, 4.8],
      [19.88, -0.21, 5.2],
      [17.53, 1.09, 4.3],
      [14.15, 2.18, 4.4],
      [2.58, 6.36, 4],
      [357.64, 7.15, 4.1],
      [355.19, 9.03, 4.3],
      [353.03, 8.87, 5],
      [351.45, 7.26, 3.7],
      [352.9, 4.43, 5],
      [356.59, 3.42, 4.5],
      [358.27, 4.55, 5],
      [348.59, 9.05, 4.5],
    ],
    paths: [
      [0, 1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 14],
      [17, 21],
    ],
  },
];
