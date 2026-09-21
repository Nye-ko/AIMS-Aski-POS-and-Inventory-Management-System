// Splits inventory export rows into worksheets: an "All Products" sheet, then one sheet per category (A-Z) with
// products sorted by name. `rows` are objects with at least `Category` and `Product Name`. Category sheets drop
// the Category column, because the sheet name already says it.
const compare = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });

export const ALL_PRODUCTS_SHEET = 'All Products';
export const UNCATEGORIZED = 'Uncategorized';

// Excel sheet names: at most 31 characters, none of \ / ? * [ ] :, and unique ignoring case.
const makeSheetNamer = () => {
  const used = new Set([ALL_PRODUCTS_SHEET.toLowerCase()]);
  return (category) => {
    const base = category.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  };
};

export const buildInventorySheets = (rows) => {
  const withCategory = rows.map((r) => ({ ...r, Category: r.Category || UNCATEGORIZED }));
  const byCategory = new Map();
  withCategory.forEach((row) => {
    if (!byCategory.has(row.Category)) byCategory.set(row.Category, []);
    byCategory.get(row.Category).push(row);
  });

  const nameFor = makeSheetNamer();
  return [
    {
      name: ALL_PRODUCTS_SHEET,
      rows: [...withCategory].sort((a, b) => compare(a.Category, b.Category) || compare(a['Product Name'], b['Product Name'])),
    },
    ...[...byCategory.keys()].sort(compare).map((category) => ({
      name: nameFor(category),
      rows: byCategory
        .get(category)
        .sort((a, b) => compare(a['Product Name'], b['Product Name']))
        .map((row) => {
          const rest = { ...row };
          delete rest.Category;
          return rest;
        }),
    })),
  ];
};
