import assert from "node:assert/strict";
import test from "node:test";
import { mapInquiryStatus } from "../../src/lib/persona";
import { appUrl } from "../../src/lib/app-url";
import { listingUpdateSchema } from "../../src/lib/validation/listing-update";

test("Persona completion is not treated as approval", () => {
  assert.equal(mapInquiryStatus("completed"), "PENDING");
  assert.equal(mapInquiryStatus("approved"), "APPROVED");
});

test("listing owners cannot publish directly through the update schema", () => {
  assert.equal(listingUpdateSchema.safeParse({ status: "ACTIVE" }).success, false);
  assert.equal(listingUpdateSchema.safeParse({ status: "SOLD" }).success, true);
  assert.equal(listingUpdateSchema.safeParse({ status: "REMOVED" }).success, true);
});

test("production public URLs reject local, malformed, and quoted origins", () => {
  const keys = ["AUTH_URL", "NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousNodeEnv = Object.getOwnPropertyDescriptor(process.env, "NODE_ENV");
  try {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      configurable: true,
      enumerable: true,
      writable: true,
    });
    delete process.env.NEXTAUTH_URL;
    process.env.AUTH_URL = "https://vera.example";
    assert.equal(appUrl(), "https://vera.example");

    process.env.AUTH_URL = "http://localhost:3000";
    assert.throws(() => appUrl(), /public HTTPS origin/);

    process.env.AUTH_URL = 'https://"vera-market".vercel.app';
    assert.throws(() => appUrl(), /valid absolute URLs|embedded quotes/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    if (previousNodeEnv) {
      Object.defineProperty(process.env, "NODE_ENV", previousNodeEnv);
    } else {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    }
  }
});
