/**
 * The icons an admin may give a category (Categories → "Choose from icon library").
 *
 * Every entry is a Lucide component: a tree-shaken, inline SVG — no icon font,
 * no sprite request, no runtime dependency. The storefront renders exactly the
 * one icon the category uses; the picker is the only place that imports all 24.
 */
import {
  BookOpen,
  Camera,
  Coffee,
  Dumbbell,
  Flower2,
  Footprints,
  Gamepad2,
  Gem,
  Gift,
  Glasses,
  Headphones,
  House,
  Lamp,
  Laptop,
  PawPrint,
  Plane,
  Shirt,
  ShoppingBag,
  Smartphone,
  Sofa,
  Sparkles,
  Tag,
  Utensils,
  Watch,
  type LucideIcon,
} from "lucide-react";

export type CategoryIconOption = { id: string; label: string; Icon: LucideIcon };

/** 24 icons, in reading order. */
export const CATEGORY_ICONS: CategoryIconOption[] = [
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
