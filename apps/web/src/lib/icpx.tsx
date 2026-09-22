import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import RentModal from "@/components/RentModal";
import WhitelistModal from "@/components/WhitelistModal";

// This module creates a React Context and also imports RentModal/WhitelistModal.
// Editing either modal during dev triggers a hot-reload here, which would
// otherwise re-run createContext() and produce a *new* context object while
// consumers elsewhere (e.g. Home) still hold the old one — causing a spurious
// "must be used within a Provider" overlay. Force a full reload on any change
// in this module's dependency graph instead of a partial HMR swap. This is a
// dev-only no-op in production builds (import.meta.hot is undefined there).
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot?.invalidate();
  });
}

interface OpenRentOptions {
  model?: string;
  templateId?: string;
}

interface IcpxContextValue {
  openRent: (model?: string) => void;
  openRentWith: (opts: OpenRentOptions) => void;
  openWhitelist: () => void;
}

const IcpxContext = createContext<IcpxContextValue | null>(null);

export function useIcpx(): IcpxContextValue {
  const ctx = useContext(IcpxContext);
  if (!ctx) throw new Error("useIcpx must be used within an IcpxProvider");
  return ctx;
}

export function IcpxProvider({ children }: { children: ReactNode }) {
  const [rentOpen, setRentOpen] = useState(false);
  const [rentModel, setRentModel] = useState<string | undefined>(undefined);
  const [rentTemplateId, setRentTemplateId] = useState<string | undefined>(
    undefined,
  );
  const [whitelistOpen, setWhitelistOpen] = useState(false);

  const openRentWith = useCallback((opts: OpenRentOptions) => {
    setRentModel(opts.model);
    setRentTemplateId(opts.templateId);
    setRentOpen(true);
  }, []);
  const openRent = useCallback(
    (model?: string) => openRentWith({ model }),
    [openRentWith],
  );
  const openWhitelist = useCallback(() => setWhitelistOpen(true), []);

  return (
    <IcpxContext.Provider value={{ openRent, openRentWith, openWhitelist }}>
      {children}
      <RentModal
        open={rentOpen}
        initialModel={rentModel}
        initialTemplateId={rentTemplateId}
        onClose={() => setRentOpen(false)}
      />
      <WhitelistModal open={whitelistOpen} onClose={() => setWhitelistOpen(false)} />
    </IcpxContext.Provider>
  );
}
