// Maps a product/category name to a distinct, representative lucide icon — shared by cashierPOS.jsx
// and inventoryList.jsx so a product shows the identical glyph at the register and in inventory, and a
// category only ever needs to be added/changed in one place.
import {
  Package, Sprout, Leaf, Wheat, SprayCan, Wrench,
  Pill, PaintBucket, ShoppingBag, Milk, Coffee, Soup, Cylinder,
} from 'lucide-react';

export const CATEGORY_ICONS = {
  seeds: Sprout,
  fertilizers: Leaf,
  feeds: Wheat,
  pesticides: SprayCan,
  tools: Wrench,
  hardware: Wrench,
  medicine: Pill,
  pharmacy: Pill,
  paint: PaintBucket,
  paints: PaintBucket,
  grocery: ShoppingBag,
  dairy: Milk,
  bakery: Wheat,
  snacks: ShoppingBag,
  beverages: Coffee,
  household: SprayCan,
  pantry: Soup,
  'canned goods': Cylinder,
};

export const getCategoryIcon = (category) => {
  if (!category) return Package;
  return CATEGORY_ICONS[category.toLowerCase()] || Package;
};
