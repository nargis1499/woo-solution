/**
 * The icons an admin may give a category (Categories → "Set icon").
 *
 * Every entry is a Lucide component: a tree-shaken, inline SVG — no icon font,
 * no sprite request, no runtime dependency. The storefront renders exactly the
 * one icon the category uses; the picker is the only place that imports all 48.
 */
import {
  Baby,
  Backpack,
  Bath,
  Bed,
  Bike,
  BookOpen,
  Cake,
  Camera,
  Car,
  Coffee,
  Cpu,
  Crown,
  Dumbbell,
  Flower2,
  Footprints,
  Gamepad2,
  Gem,
  Gift,
  Glasses,
  Headphones,
  Heart,
  House,
  IceCream,
  Lamp,
  Laptop,
  Leaf,
  Music,
  Palette,
  PawPrint,
  Pizza,
  Plane,
  Plug,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sparkles,
  Speaker,
  Star,
  Store,
  Tag,
  TreePine,
  Truck,
  Tv,
  Utensils,
  Watch,
  type LucideIcon,
} from "lucide-react";

export type CategoryIconOption = { id: string; label: string; Icon: LucideIcon };

/** 48 icons: the original 24, then the extended 24. */
export const CATEGORY_ICONS: CategoryIconOption[] = [
  // ── the original twenty-four ─────────────────────────────────────────────
  { id: "shopping-bag", label: "Shopping bag", Icon: ShoppingBag },
  { id: "tag", label: "Tag", Icon: Tag },
  { id: "sparkles", label: "Sparkles", Icon: Sparkles },
  { id: "shirt", label: "Shirt", Icon: Shirt },
  { id: "footprints", label: "Footprints", Icon: Footprints },
  { id: "watch", label: "Watch", Icon: Watch },
  { id: "glasses", label: "Glasses", Icon: Glasses },
  { id: "gem", label: "Gem", Icon: Gem },
  { id: "gift", label: "Gift", Icon: Gift },
  { id: "laptop", label: "Laptop", Icon: Laptop },
  { id: "smartphone", label: "Smartphone", Icon: Smartphone },
  { id: "headphones", label: "Headphones", Icon: Headphones },
  { id: "camera", label: "Camera", Icon: Camera },
  { id: "gamepad-2", label: "Gamepad", Icon: Gamepad2 },
  { id: "house", label: "House", Icon: House },
  { id: "sofa", label: "Sofa", Icon: Sofa },
  { id: "lamp", label: "Lamp", Icon: Lamp },
  { id: "utensils", label: "Utensils", Icon: Utensils },
  { id: "coffee", label: "Coffee", Icon: Coffee },
  { id: "book-open", label: "Book", Icon: BookOpen },
  { id: "dumbbell", label: "Dumbbell", Icon: Dumbbell },
  { id: "paw-print", label: "Paw print", Icon: PawPrint },
  { id: "flower", label: "Flower", Icon: Flower2 },
  { id: "plane", label: "Plane", Icon: Plane },
  // ── the extended twenty-four ─────────────────────────────────────────────
  { id: "shopping-cart", label: "Shopping cart", Icon: ShoppingCart },
  { id: "store", label: "Store", Icon: Store },
  { id: "backpack", label: "Backpack", Icon: Backpack },
  { id: "bike", label: "Bike", Icon: Bike },
  { id: "car", label: "Car", Icon: Car },
  { id: "truck", label: "Truck", Icon: Truck },
  { id: "baby", label: "Baby", Icon: Baby },
  { id: "heart", label: "Heart", Icon: Heart },
  { id: "star", label: "Star", Icon: Star },
  { id: "crown", label: "Crown", Icon: Crown },
  { id: "palette", label: "Palette", Icon: Palette },
  { id: "scissors", label: "Scissors", Icon: Scissors },
  { id: "music", label: "Music", Icon: Music },
  { id: "speaker", label: "Speaker", Icon: Speaker },
  { id: "tv", label: "TV", Icon: Tv },
  { id: "cpu", label: "Chip", Icon: Cpu },
  { id: "plug", label: "Plug", Icon: Plug },
  { id: "bath", label: "Bath", Icon: Bath },
  { id: "bed", label: "Bed", Icon: Bed },
  { id: "pizza", label: "Pizza", Icon: Pizza },
  { id: "cake", label: "Cake", Icon: Cake },
  { id: "ice-cream", label: "Ice cream", Icon: IceCream },
  { id: "leaf", label: "Leaf", Icon: Leaf },
  { id: "tree", label: "Tree", Icon: TreePine },
];

/** What a category without a picture and without a picked icon shows. */
export const DEFAULT_CATEGORY_ICON_ID = "shopping-bag";

/** id → component, for a direct lookup at render time. */
export const CATEGORY_ICON_BY_ID: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICONS.map((option) => [option.id, option.Icon]),
);

export const DEFAULT_CATEGORY_ICON: LucideIcon = CATEGORY_ICON_BY_ID[DEFAULT_CATEGORY_ICON_ID];

export function isCategoryIconId(value: string | null | undefined): value is string {
  return Boolean(value && value in CATEGORY_ICON_BY_ID);
}
