import { redirect } from "next/navigation";

export default function TradesAliasPage() {
  redirect("/spreads/archive?activity=trade");
}
