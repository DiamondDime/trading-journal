import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { getT } from "@/lib/i18n/server";

// getT() reads the `csj-locale` cookie which is per-request, so this page
// can't render statically. The other wizard step pages already use
// `force-dynamic` for the same reason.
export const dynamic = "force-dynamic";

export default async function AddIndexPage() {
  const t = await getT();
  const OPTIONS = [
    {
      caption: t("wizard.add.options.spread.caption"),
      title: t("wizard.add.options.spread.title"),
      description: t("wizard.add.options.spread.description"),
      href: "/add/spread/source",
      badge: t("wizard.add.autoManual"),
    },
    {
      caption: t("wizard.add.options.trade.caption"),
      title: t("wizard.add.options.trade.title"),
      description: t("wizard.add.options.trade.description"),
      href: "/add/trade/source",
      badge: t("wizard.add.autoManual"),
    },
    {
      caption: t("wizard.add.options.sale.caption"),
      title: t("wizard.add.options.sale.title"),
      description: t("wizard.add.options.sale.description"),
      href: "/add/sale/fields",
      badge: t("wizard.add.manual"),
    },
    {
      caption: t("wizard.add.options.airdrop.caption"),
      title: t("wizard.add.options.airdrop.title"),
      description: t("wizard.add.options.airdrop.description"),
      href: "/add/airdrop/fields",
      badge: t("wizard.add.manual"),
    },
  ];

  return (
    <WizardShell
      title={t("wizard.add.title")}
      subtitle={t("wizard.add.subtitle")}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {OPTIONS.map((opt) => (
          <WizardRadioCardLink key={opt.title} {...opt} />
        ))}
      </div>

      <p className="mt-12 font-serif text-sm italic text-text-tertiary">
        {t("wizard.add.footnote")}
      </p>
    </WizardShell>
  );
}
