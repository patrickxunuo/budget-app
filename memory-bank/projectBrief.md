# Project Brief

## Client / Project Name

Budget App, an open-source self-hosted family budgeting application.

## Business Context

Budget App helps Canadian households collaboratively understand spending and manage budgets while preserving private, member-owned financial data. Each installation has one family workspace backed by a user-owned hosted Supabase project.

## Core Requirements

- Support one family workspace with Family and Personal data scopes.
- Import read-only bank data through Plaid Transactions; never initiate transfers or payments.
- Limit v1 to CAD chequing, savings, and credit-card accounts.
- Keep Plaid credentials, access tokens, encryption keys, and Supabase service-role access server-only.
- Deploy through the supported Vercel and hosted Supabase path.

## Success Criteria

Household members can safely collaborate on family finances while row-level authorization prevents normal app and API access to another member's Personal data.

## Constraints

- Canada and CAD only in v1.
- One workspace per installation.
- Infrastructure administrators are trusted and outside the application threat boundary.
- Native clients and a bundled Docker platform are out of scope.
