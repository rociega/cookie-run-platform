import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect, type ReactNode } from "react";
import Home from "@/pages/home";
import PublicLanding from "@/pages/public-landing";
import Rewards from "@/pages/rewards";
import Rentals from "@/pages/rentals";
import Marketplace from "@/pages/marketplace";
import Gpus from "@/pages/gpus";
import Stats from "@/pages/stats";
import Benchmarks from "@/pages/benchmarks";
import { SolanaProvider } from "@/lib/wallet";
import { IcpxProvider } from "@/lib/icpx";
import { RewardsAuthProvider } from "@/lib/rewardsAuth";
import WalletWelcomeModal from "@/components/WalletWelcomeModal";
import CookieConsent from "@/components/CookieConsent";
import Privacy from "@/pages/privacy";
import Cookies from "@/pages/cookies";
import AuthLayout from "@/components/AuthLayout";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/cookie-run-mark-transparent.png`,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#000000",
    colorForeground: "#000000",
    colorMutedForeground: "#666666",
    colorBackground: "transparent",
    colorInput: "transparent",
    colorInputForeground: "#000000",
    colorDanger: "#000000",
    colorNeutral: "#000000",
    fontFamily: "var(--font-sans)",
    borderRadius: "0px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "w-[440px] max-w-full overflow-hidden bg-transparent border border-[#e5e5e5] rounded-none",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#000000] font-sans text-2xl font-bold tracking-tight",
    headerSubtitle: "text-[#666666]",
    socialButtonsBlockButtonText: "text-[#000000] font-semibold",
    formFieldLabel: "text-[#000000] font-mono text-[11px] uppercase tracking-wider font-semibold",
    footerActionLink: "text-black underline decoration-black underline-offset-4 font-semibold",
    footerActionText: "text-[#666666]",
    dividerText: "text-[#666666] font-mono text-[11px] uppercase tracking-widest",
    identityPreviewEditButton: "text-black",
    formFieldSuccessText: "text-[#000000]",
    alertText: "text-[#000000]",
    logoBox: "mb-6",
    logoImage: "h-8 w-auto grayscale contrast-125",
    socialButtonsBlockButton: "border-[#e5e5e5] rounded-none hover:border-black bg-transparent text-sm",
    formButtonPrimary: "bg-black hover:bg-black border border-black rounded-none font-sans font-semibold text-white transition-colors h-11 text-sm",
    formFieldInput: "border-[#e5e5e5] rounded-none bg-transparent focus:border-black focus:ring-0 h-10",
    footerAction: "border-t border-[#e5e5e5]",
    dividerLine: "bg-[#e5e5e5]",
    alert: "border-[#e5e5e5] rounded-none",
    otpCodeFieldInput: "border-[#e5e5e5] rounded-none bg-transparent focus:border-black",
    formFieldRow: "gap-3",
    main: "gap-6",
  },
};

function SignInPage() {
  return (
    <AuthLayout>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </AuthLayout>
  );
}

function SignUpPage() {
  return (
    <AuthLayout>
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </AuthLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={PublicLanding} />
      <Route path="/platform" component={Home} />
      {/* Keep the former dashboard URL working for existing bookmarks. */}
      <Route path="/dashboard" component={Home} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/rewards" component={Rewards} />
      {/* Legacy rewards URL retained while /rewards remains canonical. */}
      <Route path="/earn" component={Rewards} />
      <Route path="/workspaces" component={Rentals} />
      <Route path="/rentals" component={Rentals} />
      <Route path="/marketplace" component={Marketplace} />
      <Route path="/gpus" component={Gpus} />
      <Route path="/stats" component={Stats} />
      <Route path="/benchmarks" component={Benchmarks} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/cookies" component={Cookies} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "ENTER COOKIE RUN",
            subtitle: "Sign in to manage your developer machines",
          },
        },
        signUp: {
          start: {
            title: "CREATE ACCOUNT",
            subtitle: "Your account and wallet stay separate by design",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      {children}
    </ClerkProvider>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes>
        <QueryClientProvider client={queryClient}>
          <SolanaProvider>
            <RewardsAuthProvider>
              <TooltipProvider>
                <IcpxProvider>
                  <Router />
                  <WalletWelcomeModal />
                  <CookieConsent />
                  <Toaster />
                </IcpxProvider>
              </TooltipProvider>
            </RewardsAuthProvider>
          </SolanaProvider>
        </QueryClientProvider>
      </ClerkProviderWithRoutes>
    </WouterRouter>
  );
}

export default App;
