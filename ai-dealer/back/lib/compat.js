// Lightweight compatibility helpers for merge-vehicles.json schema
// Ensures flat fallbacks for code that expects strings instead of objects
function normalizeItem(x){
  if (!x || typeof x !== 'object') return x;
  if (x.fuel && typeof x.fuel === 'object') {
    x.fuelName = x.fuel.name || x.fuelName || null;
    x.fuelCode = x.fuel.code || x.fuelCode || null;
  }
  if (x.color && typeof x.color === 'object') {
    x.colorName = x.color.name || x.colorName || null;
    x.colorCode = x.color.code || x.colorCode || null;
    x.colorRGB  = x.color.rgb  || x.colorRGB  || null;
  }
  if (x.options && typeof x.options === 'object') {
    if (!x.optionNames && Array.isArray(x.options.names)) x.optionNames = x.options.names;
    if (!x.optionCodes && Array.isArray(x.options.codes)) x.optionCodes = x.options.codes;
  }
  if (x.km != null && x.km == null) {
    x.km = x.km;
    delete x.km;
  }
  return x;
}
module.exports = { normalizeItem };
