-- GH-4: commit the pending Plaid Item lifecycle value before later migrations
-- reference it in constraints, defaults, functions, or data.
alter type public.plaid_item_status add value if not exists 'pending' before 'active';
