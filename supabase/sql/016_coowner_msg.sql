-- Frixion: allow Co-Owners (rank >= 2) the same 900,000-character message cap as the Owner (no Update Log entry).
create or replace function fx.text_fits(t jsonb, m fx.person) returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(t) = 'string' and length(t #>> '{}') <= case when m.ok and m.rank >= 2 then 900000 else 10000 end, false)
$$;
