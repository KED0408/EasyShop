import Tabs from "@/components/Tabs";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Tabs />
    </>
  );
}
