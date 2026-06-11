-- Update cosmetic pack price to 50
update public.shop_items
set price_gold = 50
where id = 'cosmetic-pack';

-- Register new titles in cosmetic_catalog
insert into public.cosmetic_catalog (kind, id, display_name, asset_path)
values
  ('title', 'sixty_seven', 'Sixty Seven', null),
  ('title', 'salmon_dream', 'Salmon Dream', null),
  ('title', 'how_pitiful', 'How Pitiful', null),
  ('title', 'kaohsiung_fortune', 'Kaohsiung Fortune', null),
  ('title', 'duck_blood_tofu', 'Duck Blood Tofu', null),
  ('title', 'taoyuan_hsinchu', 'Taoyuan Hsinchu', null)
on conflict (kind, id) do update
  set display_name = excluded.display_name,
      asset_path = excluded.asset_path,
      active = true;
