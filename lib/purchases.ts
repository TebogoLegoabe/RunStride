// Buying Plus and race passes.
//
// Development: purchases are granted straight away by the API, with no store and no charge.
// Store builds: this is where RevenueCat's SDK (react-native-purchases) makes the purchase.
// The store tells RevenueCat, RevenueCat tells our API (/webhooks/revenuecat), and the app
// then reloads its membership. Store purchases need a development build; Expo Go can't make them.
import { spendRacePass, testPurchase } from "./api";
import type { Membership, ProductId } from "./types";

export class PurchasesUnavailable extends Error {}

export async function buy(
  token: string,
  membership: Membership,
  productId: ProductId,
  raceId?: string
): Promise<Membership> {
  if (membership.testPurchases) return testPurchase(token, productId, raceId);
  throw new PurchasesUnavailable(
    "Plus and race passes go on sale when RunStride launches in the App Store and Google Play."
  );
}

// A race pass bought earlier and not used yet: spend it on this race instead of buying another
export async function getRacePass(
  token: string,
  membership: Membership,
  raceId: string
): Promise<Membership> {
  if (membership.racePassCredits > 0) return spendRacePass(token, raceId);
  return buy(token, membership, "race_pass", raceId);
}
