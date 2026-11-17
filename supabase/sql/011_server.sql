-- Frixion on Supabase, part 11: what the server (functions/api) needs besides fx_get, fx_query and fx_commit.
-- Several documents in one request, like Firestore's batchGet: the push function reads every recipient's profile and
-- block list at once, and a Cloudflare function may only make 50 requests. Each comes back the way public.fx_get gives
-- it, with its path. Only the server's secret key may call it.
create or replace function public.fx_get_many(paths jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare p text; res jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(paths) is distinct from 'array' or jsonb_array_length(paths) > 500 then
    raise exception 'a list of up to 500 paths' using errcode = 'FX400';
  end if;
  for p in select jsonb_array_elements_text(paths) loop
    res := res || jsonb_build_array(public.fx_get(p) || jsonb_build_object('path', p));
  end loop;
  return res;
end $$;
revoke execute on function public.fx_get_many(jsonb) from public, anon, authenticated;
grant execute on function public.fx_get_many(jsonb) to service_role;
