import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardDefinition } from "@twcardgame/cards";
import type { Seat } from "@twcardgame/shared";
import type { ClientViewState } from "./types.js";

export type AppContext = {
  view: ClientViewState;
  render: () => void;
  supabase: SupabaseClient | undefined;
  cardCatalog: Map<string, CardDefinition>;
  seats: Seat[];
};

let currentContext: AppContext | undefined;

export function setAppContext(context: AppContext): void {
  currentContext = context;
}

export function getAppContext(): AppContext {
  if (!currentContext) throw new Error("App context has not been initialized.");
  return currentContext;
}
