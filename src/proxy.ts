import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { pageSlugFromPath, publishedPageExists } from "@/lib/pages/proxy-guard";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  if (response.headers.has("location")) return response; // auth redirect – nothing else to do

  // Single-segment paths that are not a storefront route are CMS pages
  // (`/about-us`). Unknown ones become a real 404 instead of a 200 "not found"
  // shell – see lib/pages/proxy-guard.ts.
  if (request.method === "GET" || request.method === "HEAD") {
    const slug = pageSlugFromPath(request.nextUrl.pathname);
    if (slug && (await publishedPageExists(slug)) === false) {
      const url = request.nextUrl.clone();
      url.pathname = `/__not-found/${slug}`; // no route matches → app/not-found.tsx with status 404
      url.search = "";
      const notFound = NextResponse.rewrite(url, { request });
      for (const cookie of response.cookies.getAll()) notFound.cookies.set(cookie); // keep refreshed auth cookies
      return notFound;
    }
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
