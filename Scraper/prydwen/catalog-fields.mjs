const safeKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

// Split only pipe segments that contain a real label/value separator. Ordinary
// pipe text remains attached to the prior value.
export function parseCatalogFieldLine(line) {
  const out = [];
  for (const segment of String(line || '').split(/\s*\|\s*/)) {
    const match = segment.match(/^([^:]{2,80}):\s*(.*)$/);
    if (match) {
      const key = safeKey(match[1]);
      if (key) out.push({ key, value:clean(match[2]) });
    } else if (out.length && clean(segment)) {
      out[out.length - 1].value = clean(`${out[out.length - 1].value} | ${segment}`);
    }
  }
  return out;
}

export function parseCatalogFields(segment) {
  const fields = {};
  const bonuses = [];
  for (let index = 1; index < (segment || []).length; index += 1) {
    const line = clean(segment[index]);
    if (/^\(\d+\)/.test(line)) {
      bonuses.push(line);
      continue;
    }
    const fieldsOnLine = parseCatalogFieldLine(line);
    if (!fieldsOnLine.length) continue;
    if (!fieldsOnLine[0].value && segment[index + 1] && !String(segment[index + 1]).includes(':')) {
      fieldsOnLine[0].value = clean(segment[index + 1]);
      index += 1;
    }
    for (const field of fieldsOnLine) fields[field.key] = clean(field.value);
  }
  if (bonuses.length) fields.bonuses = bonuses;
  return fields;
}
