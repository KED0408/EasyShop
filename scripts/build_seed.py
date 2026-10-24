"""Generate supabase/seed/0002_seed.sql from data/tracker-meals.json plus the
store-cupboard list taken from the Tesco (16 Oct 2026) and Morrisons (23 Oct 2026) orders.

Nutrition values are approximate per-100 g figures (UK typical / CoFID-style) and can be
edited in the app. Run: python3 scripts/build_seed.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
tracker = json.loads((ROOT / "data" / "tracker-meals.json").read_text())

CAT = {"Meat & fish": "Meat & fish", "Dairy & eggs": "Dairy & eggs",
       "Fruit & veg": "Fruit & veg", "Cupboard": "Tins, jars & dry"}
KEEP = {"Meat & fish": 2, "Dairy & eggs": 7, "Fruit & veg": 5, "Tins, jars & dry": 180}

# name: (kcal, protein, carbs, fat) per 100 g, each_grams for 'each' items, keep_days override
N = {
 "Greek yogurt (full-fat, e.g. Fage 5%)": (93, 9, 3.8, 5, None, 7),
 "Thai green curry paste": (110, 2, 10, 7, None, 30),
 "almonds": (612, 21, 7, 54, None, 180),
 "avocados": (190, 1.9, 1.9, 19.5, 140, 4),
 "back bacon medallions": (108, 21, 0.5, 2.2, 30, 7),
 "beef mince 5%": (124, 21, 0, 4.5, None, 2),
 "black olives": (145, 1, 3.5, 14, None, 14),
 "blueberries": (51, 0.9, 9.7, 0.3, None, 5),
 "butter": (744, 0.6, 0.6, 82, None, 30),
 "caesar dressing (light)": (150, 2, 8, 12, None, 30),
 "capers": (23, 2.4, 4.9, 0.9, None, 90),
 "cauliflower": (34, 3.6, 3.0, 0.9, None, 5),
 "cauliflower rice (fresh/frozen)": (28, 2.5, 3.0, 0.4, None, 5),
 "cheddar": (416, 25, 0.1, 34.9, None, 28),
 "cherry tomatoes": (20, 0.8, 3.0, 0.3, None, 5),
 "chicken breast (raw)": (106, 24, 0, 1.1, None, 2),
 "chicken thighs boneless skinless": (150, 19, 0, 8, None, 2),
 "chopped tomatoes (tin)": (21, 1.1, 3.5, 0.1, None, 365),
 "cod loin fillets": (80, 18, 0, 0.7, None, 2),
 "cooked ham (thick-cut)": (107, 20, 1, 2.6, None, 4),
 "cooking chorizo": (400, 23, 2, 33, None, 14),
 "cos lettuce": (16, 1.0, 1.7, 0.6, None, 4),
 "cottage cheese": (80, 11, 3.5, 2.5, None, 5),
 "courgette": (18, 1.8, 1.8, 0.4, None, 5),
 "cucumber": (10, 0.7, 1.5, 0.1, None, 5),
 "dark chocolate 85%": (600, 11, 16, 50, None, 180),
 "double cream": (467, 1.7, 1.7, 50, None, 5),
 "eggs": (131, 12.6, 0.1, 9, 50, 21),
 "fajita spice": (300, 10, 50, 5, None, 365),
 "feta": (250, 16, 1, 20, None, 7),
 "fresh herbs (parsley, mint, coriander)": (40, 3, 5, 0.6, 30, 5),
 "garlic & spices": (0, 0, 0, 0, 1, 365),
 "green beans": (25, 1.9, 3.2, 0.4, None, 5),
 "king prawns (raw)": (70, 16, 0, 0.8, None, 2),
 "lamb mince": (240, 17, 0, 19, None, 2),
 "lemon": (29, 1, 3, 0.3, 100, 14),
 "light coconut milk": (75, 0.7, 1.8, 7, None, 3),
 "limes": (30, 0.7, 8, 0.2, 65, 14),
 "little gem lettuce": (15, 1.2, 1.7, 0.4, None, 5),
 "mixed nuts": (620, 20, 9, 55, None, 180),
 "mushrooms": (13, 1.8, 0.4, 0.5, None, 5),
 "olive oil": (899, 0, 0, 99.9, None, 365),
 "onions": (36, 1.2, 7.9, 0.2, 150, 21),
 "pak choi": (13, 1.5, 1.2, 0.2, None, 4),
 "parmesan": (415, 36, 0, 30, None, 60),
 "pesto": (450, 5, 6, 45, None, 14),
 "pork mince (5% fat)": (125, 20, 0, 5, None, 2),
 "pork tenderloin": (120, 22, 0, 3.5, None, 2),
 "raspberries": (32, 1.3, 5.3, 0.3, None, 3),
 "red peppers": (32, 1.0, 6.4, 0.4, 160, 7),
 "roasted peanuts": (600, 25, 10, 50, None, 180),
 "salmon fillets": (208, 20, 0, 13.6, None, 2),
 "sea bass fillets": (120, 20, 0, 4.5, None, 2),
 "sesame oil": (884, 0, 0, 100, None, 365),
 "sirloin steak": (170, 23, 0, 8.5, None, 3),
 "smoked salmon": (180, 23, 0, 10, None, 5),
 "soured cream": (190, 2.7, 3.9, 18, None, 5),
 "soy sauce": (50, 8, 4, 0, None, 365),
 "spinach": (25, 2.8, 1.6, 0.8, None, 4),
 "tenderstem broccoli": (35, 3.6, 2.5, 0.6, None, 5),
 "tomatoes": (18, 0.9, 3.1, 0.2, 85, 5),
 "tuna in spring water (tins)": (110, 25, 0, 0.6, 112, 365),
 "turkey mince (2% fat)": (105, 22, 0, 2, None, 2),
 "whey protein (optional)": (380, 75, 8, 6, None, 365),
}

# Store cupboard from your orders: (name, category, usual pack, brand lock, frequency)
# "weekly" = bought in both orders; everything else starts as "as needed".
CUPBOARD = [
 # Drinks
 ("Coca-Cola Zero Sugar", "Drinks", "8 × 330 ml cans", "Coca-Cola", "as_needed"),
 ("Diet Coke", "Drinks", "8 × 330 ml cans", "Coca-Cola", "as_needed"),
 ("Ginger beer", "Drinks", "4 × 375 ml bottles", "Bundaberg", "as_needed"),
 ("Still mineral water", "Drinks", "8 × 500 ml", "Buxton", "as_needed"),
 ("Apple juice", "Drinks", "1 L", None, "as_needed"),
 ("Almond milk", "Drinks", "1 L", "Plenish", "as_needed"),
 ("Whole milk", "Dairy & eggs", "4 pints (2.272 L)", None, "weekly"),
 ("Skimmed milk", "Dairy & eggs", "2 pints (1.136 L)", None, "weekly"),
 ("Lungo coffee pods", "Drinks", "10 pods", None, "as_needed"),
 # Bread & bakery
 ("Granary bread", "Bread & bakery", "800 g loaf", "Hovis", "as_needed"),
 ("Plain bagels", "Bread & bakery", "5 pack", None, "weekly"),
 ("Oatcakes", "Bread & bakery", "218 g", "Nairn's", "as_needed"),
 # Fridge extras
 ("Baby plum tomatoes", "Fruit & veg", "250 g", None, "as_needed"),
 ("Iceberg lettuce", "Fruit & veg", "each", None, "as_needed"),
 ("Romaine lettuce hearts", "Fruit & veg", "2 pack", None, "weekly"),
 ("Sweetheart cabbage", "Fruit & veg", "each", None, "as_needed"),
 ("Carrots", "Fruit & veg", "1 kg", None, "as_needed"),
 ("Red onions", "Fruit & veg", "1 kg", None, "as_needed"),
 ("Gala apples", "Fruit & veg", "pack", None, "as_needed"),
 ("Bananas", "Fruit & veg", "5 pack", None, "as_needed"),
 ("Baby potatoes", "Fruit & veg", "1 kg", None, "as_needed"),
 ("Baking potatoes", "Fruit & veg", "4 pack", None, "as_needed"),
 ("Sweet potatoes", "Fruit & veg", "1 kg", None, "as_needed"),
 ("Pork loin steaks", "Meat & fish", "400–600 g", None, "weekly"),
 ("Frankfurters", "Meat & fish", "350 g", None, "as_needed"),
 ("Italian meat selection", "Meat & fish", "120 g", None, "as_needed"),
 ("Flame-grilled chicken mini fillets", "Meat & fish", "170 g", None, "as_needed"),
 ("Greek-style cooked chicken pieces", "Meat & fish", "180 g", None, "as_needed"),
 ("Cooked ham slices", "Meat & fish", "120 g", None, "as_needed"),
 ("Lighter mature cheese", "Dairy & eggs", "400 g", None, "as_needed"),
 ("Cambozola", "Dairy & eggs", "175 g", None, "as_needed"),
 ("French brie", "Dairy & eggs", "200 g", None, "as_needed"),
 ("Reduced-fat crème fraîche", "Dairy & eggs", "600 ml", None, "as_needed"),
 ("Classic houmous", "Dairy & eggs", "300 g", None, "as_needed"),
 ("Cheese snack strings", "Snacks & confectionery", "8 × 20 g", "Cheestrings", "as_needed"),
 ("Cheese dunkers", "Snacks & confectionery", "6 pack", "Dairylea", "as_needed"),
 ("Müller Corner yogurts", "Dairy & eggs", "each", "Müller", "as_needed"),
 ("Stonebaked pizza (meat feast / pepperoni)", "Frozen", "each", None, "as_needed"),
 # Snacks & confectionery
 ("Jaffa Cakes", "Snacks & confectionery", "pack", "McVitie's", "weekly"),
 ("Mr Kipling cake slices (Angel / Bakewell)", "Snacks & confectionery", "6 pack", "Mr Kipling", "as_needed"),
 ("Rich Tea biscuits", "Snacks & confectionery", "300 g", None, "as_needed"),
 ("Belgian chocolate bar", "Snacks & confectionery", "220 g", "Options", "as_needed"),
 ("Crisps multipack", "Snacks & confectionery", "6–14 bags", "Walkers", "weekly"),
 ("Popchips BBQ multipack", "Snacks & confectionery", "5 × 17 g", "Popchips", "as_needed"),
 ("Microwave popcorn", "Snacks & confectionery", "3 × 60 g", "Butterkist", "as_needed"),
 ("Cheddar cheese twists", "Snacks & confectionery", "125 g", None, "as_needed"),
 ("Cashew nuts", "Snacks & confectionery", "250 g", None, "as_needed"),
 # Desserts & frozen
 ("Ice cream sandwiches", "Frozen", "4 × 68 ml", "Ben & Jerry's", "as_needed"),
 ("Bakewell tart / cheesecake", "Desserts", "each", None, "as_needed"),
 ("Custard (can)", "Desserts", "400 g", "Ambrosia", "as_needed"),
 ("Petits pois (frozen)", "Frozen", "1 kg", None, "as_needed"),
 ("Basa fillets (frozen)", "Frozen", "450 g", None, "as_needed"),
 ("Cod fillets (frozen)", "Frozen", "320 g", None, "as_needed"),
 ("Fine green beans (frozen)", "Frozen", "900 g", None, "as_needed"),
 ("Hash browns (frozen)", "Frozen", "750 g", None, "as_needed"),
 ("Sliced leeks (frozen)", "Frozen", "700 g", None, "as_needed"),
 # Tins, jars & dry
 ("Tomato purée", "Tins, jars & dry", "200 g", None, "as_needed"),
 ("Bolognese pasta sauce", "Tins, jars & dry", "350 g", None, "as_needed"),
 ("Spirali pasta", "Tins, jars & dry", "500 g", None, "as_needed"),
 ("Fajita kit", "Tins, jars & dry", "475 g", None, "as_needed"),
 ("Chicken noodle cup soups", "Tins, jars & dry", "5 pack", None, "as_needed"),
 ("Sweet & spicy noodle cup soups", "Tins, jars & dry", "5 pack", None, "as_needed"),
 ("Fresh soup (tomato / carrot & coriander)", "Tins, jars & dry", "560 g", "New Covent Garden", "as_needed"),
 ("Vegetable stock cubes", "Tins, jars & dry", "10 pack", None, "as_needed"),
 # Spices & condiments
 ("Ground cinnamon", "Spices & condiments", "36 g", None, "as_needed"),
 ("Distilled vinegar", "Spices & condiments", "568 ml", None, "as_needed"),
 # Household
 ("Washing-up liquid", "Household", "320 ml", "Fairy", "as_needed"),
 ("Laundry pods", "Household", "50 washes", "Bold", "as_needed"),
 ("Toilet tissue", "Household", "9 rolls", "Andrex", "as_needed"),
 ("Kitchen towel", "Household", "2 rolls", None, "as_needed"),
 ("Extra-large kitchen sheets", "Household", "3 rolls", "Mighty Big", "as_needed"),
 # Toiletries & health
 ("Toothpaste", "Toiletries & health", "100 ml", "Corsodyl", "as_needed"),
 ("Finger plasters", "Toiletries & health", "16 pack", "Elastoplast", "as_needed"),
]


def q(v):
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def arr(xs):
    return "'{" + ",".join(xs) + "}'"


lines = ["-- EasyShop seed: run after 0001_phase1_schema.sql. Safe to re-run (skips rows that exist).", "begin;", ""]

lines.append("-- Household members (edit names, portions and targets on the Household page)")
lines.append("""insert into public.members (name, sort, portion_factor, kcal_target_office, kcal_target_other, protein_target_office, protein_target_other, skips_on_office_days)
select * from (values
  ('Kevin', 1, 1.00, 1320, 1720, 100, 130, '{breakfast,lunch}'::text[]),
  ('Wife',  2, 0.80, 1400, 1400, 90, 90, '{}'::text[]),
  ('Son',   3, 1.00, null::int, null::int, null::int, null::int, '{}'::text[])
) v where not exists (select 1 from public.members);""")
lines.append("")

lines.append("-- Ingredients from the 64 kg Tracker")
meta = tracker["meta"]
for name, m in sorted(meta.items()):
    k, p, c, f, each_g, keep = N[name]
    unit = "each" if m["u"] == "x" else "g"
    cat = CAT[m["a"]]
    lines.append(
        "insert into public.items (name, category, unit, each_grams, kcal_100, protein_100, carbs_100, fat_100, keep_days) values "
        f"({q(name)}, {q(cat)}, {q(unit)}, {q(each_g if unit=='each' else None)}, {k}, {p}, {c}, {f}, {keep}) on conflict (name) do nothing;"
    )
lines.append("")

lines.append("-- Store cupboard from your Tesco and Morrisons orders")
for name, cat, pack, brand, freq in CUPBOARD:
    lines.append(
        "insert into public.items (name, category, unit, is_cupboard, usual_pack, brand_lock, buy_frequency, keep_days) values "
        f"({q(name)}, {q(cat)}, 'each', true, {q(pack)}, {q(brand)}, {q(freq)}, null) on conflict (name) do nothing;"
    )
lines.append("")

lines.append("-- Meals from the 64 kg Tracker (calories and protein kept from the tracker)")
for m in tracker["meals"]:
    batch = "true" if m["name"].lower().startswith("batch") else "false"
    lines.append(
        "insert into public.meals (name, slots, servings, is_batch, source, kcal_override, protein_override) values "
        f"({q(m['name'])}, {arr(m['slots'])}, 1, {batch}, 'tracker', {m['kcal']}, {m['p']}) on conflict (name) do nothing;"
    )
    for i, (item, amt) in enumerate(m["items"]):
        lines.append(
            "insert into public.meal_components (meal_id, item_id, amount, position) "
            f"select me.id, it.id, {amt}, {i} from public.meals me, public.items it "
            f"where me.name = {q(m['name'])} and it.name = {q(item)} "
            "and not exists (select 1 from public.meal_components mc where mc.meal_id = me.id and mc.item_id = it.id);"
        )
lines.append("")
lines.append("commit;")

out = ROOT / "supabase" / "migrations" / "0002_seed.sql"
out.write_text("\n".join(lines) + "\n", encoding="utf8")
print(f"wrote {out} · {len(meta)} ingredients · {len(CUPBOARD)} cupboard items · {len(tracker['meals'])} meals")
