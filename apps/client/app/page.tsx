import Link from 'next/link';
import { fetchVendors } from '@/lib/api';
import { uniqueVendorsByName } from '@/lib/vendors';
import Container from '@/components/layout/Container';
import { Search, GitCompare, ExternalLink, Phone, Clock, ShieldCheck, Star, Zap, BarChart3, ArrowRight, CheckCircle } from 'lucide-react';

async function getLandingData() {
  try {
    const { vendors } = await fetchVendors();
    return { vendors };
  } catch {
    return { vendors: [] };
  }
}

export default async function LandingPage() {
  const { vendors } = await getLandingData();
  const displayVendors = uniqueVendorsByName(vendors);

  return (
    <div className="bg-[#F7F8FA]">
      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="bg-[#111827] text-white py-20">
        <Container>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-[12px] font-medium rounded-full px-3 py-1.5 mb-6">
                <Zap size={12} />
                Built for collision repair professionals
              </div>
              <h1 className="text-[42px] font-bold tracking-tight leading-[1.1] mb-5">
                Source collision parts in seconds,<br />
                <span className="text-[#60A5FA]">not phone calls.</span>
              </h1>
              <p className="text-[16px] text-gray-300 leading-relaxed mb-8 max-w-[460px]">
                Paste a VIN to auto-fill year/make/model, search by part number, or browse by vehicle fitment — all vendors, one table.
                OEM, aftermarket, and salvage — instantly compared.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/search"
                  className="inline-flex items-center gap-2 px-5 py-3 bg-[#1F6FEB] text-white text-[14px] font-semibold rounded-md hover:bg-[#134AB5] transition-colors"
                >
                  <Search size={15} />
                  Start searching
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 px-5 py-3 bg-white/10 text-white text-[14px] font-medium rounded-md hover:bg-white/15 transition-colors"
                >
                  See how it works
                  <ArrowRight size={14} />
                </a>
              </div>
            </div>

            {/* Right side: product screenshot placeholder */}
            <div className="hidden md:block">
              <div className="bg-white/5 border border-white/10 rounded-xl p-1 shadow-2xl">
                <div className="bg-[#0B1220] rounded-lg p-4 text-[11px] font-mono">
                  {/* Simulated results table */}
                  <div className="border-b border-white/10 pb-2 mb-2 flex gap-4 text-white/40 uppercase tracking-wide text-[10px]">
                    <span className="w-32">Part</span>
                    <span className="w-20">Condition</span>
                    <span className="w-24">Vendor</span>
                    <span className="w-20 text-right">ETA</span>
                    <span className="w-20 text-right">Price</span>
                  </div>
                  {[
                    { name: 'Front Bumper Cover', pn: '52119-42230', cond: 'New OEM', vendor: 'Toyota Parts', eta: '1–2 days', price: '$342.00', best: true },
                    { name: 'Front Bumper Cover', pn: 'REPB010170P', cond: 'New A/M', vendor: 'LKQ Online', eta: 'Ships today', price: '$87.50', best: false },
                    { name: 'Front Bumper Cover', pn: 'BUM-00143', cond: 'New A/M', vendor: 'Keystone', eta: '2–3 days', price: '$94.00', best: false },
                  ].map((row, i) => (
                    <div key={i} className={`flex gap-4 py-1.5 rounded px-1 ${i === 1 ? 'bg-white/5' : ''}`}>
                      <div className="w-32">
                        <p className="text-white/90 text-[10px] truncate">{row.name}</p>
                        <p className="text-white/40 text-[9px]">{row.pn}</p>
                      </div>
                      <span className={`w-20 text-[10px] ${i === 0 ? 'text-blue-400' : 'text-green-400'}`}>{row.cond}</span>
                      <span className="w-24 text-white/70 text-[10px] truncate">{row.vendor}</span>
                      <span className="w-20 text-right text-white/60 text-[10px]">{row.eta}</span>
                      <div className="w-20 text-right">
                        <span className="text-white/90 text-[10px]">{row.price}</span>
                        {row.best || i === 1 ? <span className="ml-1 text-amber-400 text-[9px]">★ Best</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* ── Trust strip ──────────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-[#E5E7EB] py-5">
        <Container>
          <div className="flex flex-wrap items-center gap-6 justify-between">
            <p className="text-[13px] text-[#475569] font-medium">
              Aggregating inventory from:
            </p>
            <div className="flex flex-wrap gap-2">
              {displayVendors.length > 0 ? (
                displayVendors.map(v => (
                  <span
                    key={v.name}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#F7F8FA] border border-[#E5E7EB] rounded-md text-[12px] font-medium text-[#475569]"
                  >
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${v.vendorType === 'OEM' ? 'bg-blue-500' : v.vendorType === 'SALVAGE' ? 'bg-amber-500' : 'bg-green-500'}`}
                    />
                    {v.name}
                  </span>
                ))
              ) : (
                <span className="text-[12px] text-[#94A3B8]">Loading vendor list…</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-[#475569]">
              <Clock size={13} className="text-green-600" />
              <span>Inventory updated continuously</span>
            </div>
          </div>
        </Container>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-16">
        <Container>
          <h2 className="text-[22px] font-bold text-[#0B1220] mb-10 text-center">
            From search to quote in seconds
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                step: '1',
                icon: Search,
                title: 'Search by VIN, part number, or fitment',
                desc: 'Paste the customer\'s VIN to auto-fill year/make/model, search directly by OEM or aftermarket part number, or browse by vehicle fitment manually.',
              },
              {
                step: '2',
                icon: GitCompare,
                title: 'Compare vendors instantly',
                desc: 'See every available listing side-by-side: price, availability, ETA, vendor reliability, and fitment confidence — all in one table.',
              },
              {
                step: '3',
                icon: ExternalLink,
                title: 'Order from the vendor',
                desc: 'Click through to the vendor site with a single click, or copy a formatted quote line directly into your estimate email.',
              },
            ].map(item => (
              <div key={item.step} className="bg-white border border-[#E5E7EB] rounded-xl p-6 shadow-[0_1px_2px_rgba(2,6,23,0.05)]">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-[#EFF6FF] flex items-center justify-center">
                    <item.icon size={15} className="text-[#1F6FEB]" />
                  </div>
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-[#94A3B8]">Step {item.step}</span>
                </div>
                <h3 className="text-[15px] font-semibold text-[#0B1220] mb-2">{item.title}</h3>
                <p className="text-[13px] text-[#475569] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Benefits ─────────────────────────────────────────────────────────── */}
      <section className="bg-white border-y border-[#E5E7EB] py-16">
        <Container>
          <h2 className="text-[22px] font-bold text-[#0B1220] mb-3">
            Designed for how shops actually work
          </h2>
          <p className="text-[14px] text-[#475569] mb-10 max-w-[500px]">
            Estimators and parts managers are busy. Every feature is optimized to reduce clicks, reduce calls, and reduce sourcing mistakes.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Phone, title: 'Fewer phone calls', desc: 'Real-time availability across every vendor eliminates "let me check on that" calls.' },
              { icon: Clock, title: 'Faster cycle time', desc: 'Spend seconds sourcing instead of minutes. Parts get ordered faster; cars get out faster.' },
              { icon: ShieldCheck, title: 'OEM vs aftermarket at a glance', desc: 'Every listing is clearly labeled. Fitment confidence is visible on every row.' },
              { icon: BarChart3, title: 'Real ETAs, real vendors', desc: 'Delivery estimates and reliability scores from actual vendor data, not guesses.' },
            ].map(item => (
              <div key={item.title} className="p-4 rounded-xl border border-[#E5E7EB]">
                <item.icon size={20} className="text-[#1F6FEB] mb-3" strokeWidth={1.5} />
                <h3 className="text-[14px] font-semibold text-[#0B1220] mb-1">{item.title}</h3>
                <p className="text-[12px] text-[#475569] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Feature showcase ─────────────────────────────────────────────────── */}
      <section className="py-16">
        <Container>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-[22px] font-bold text-[#0B1220] mb-6">
                Everything an estimator needs to source confidently
              </h2>
              <div className="space-y-3">
                {[
                  'OEM and aftermarket search in a single query',
                  'Vehicle fitment wizard — Year → Make → Model → Part type',
                  'Vendor reliability scores on every listing',
                  'ETA and availability on every row — no separate lookup',
                  'Side-by-side comparison for up to 4 listings',
                  '"Copy as quote line" — paste directly into estimate emails',
                  'Searchable by OEM, aftermarket, or interchange part number',
                ].map(feature => (
                  <div key={feature} className="flex items-start gap-2.5">
                    <CheckCircle size={15} className="text-[#15803D] mt-0.5 shrink-0" />
                    <span className="text-[13px] text-[#475569]">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#111827] rounded-xl p-6 text-white">
              <p className="text-[12px] text-white/50 uppercase tracking-wide mb-3">Searchable vendors</p>
              {displayVendors.length === 0 ? (
                <p className="text-[13px] text-white/40 py-2">Loading vendor list…</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {(['OEM', 'AFTERMARKET', 'SALVAGE', 'MARKETPLACE'] as const)
                    .filter(type => displayVendors.some(v => v.vendorType === type))
                    .map(type => (
                      <div key={type} className="bg-white/5 rounded-lg p-3">
                        <p className="text-[11px] text-white/50 mb-1">{type}</p>
                        <p className="text-[13px] font-medium">
                          {displayVendors.filter(v => v.vendorType === type).length} connected
                        </p>
                      </div>
                    ))}
                </div>
              )}
              <p className="text-[11px] text-white/40 mt-4">More vendors added continuously.</p>
            </div>
          </div>
        </Container>
      </section>

      {/* ── CTA band ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#1F6FEB] py-14">
        <Container>
          <div className="text-center text-white">
            <h2 className="text-[28px] font-bold mb-3">Try it now — no signup required</h2>
            <p className="text-[15px] text-blue-100 mb-7 max-w-[440px] mx-auto">
              Search across every connected vendor in seconds. Start sourcing faster today.
            </p>
            <Link
              href="/search"
              className="inline-flex items-center gap-2 px-6 py-3.5 bg-[#D97706] text-white text-[15px] font-bold rounded-md hover:bg-[#B45309] transition-colors shadow-lg"
            >
              <Search size={16} />
              Start searching parts
            </Link>
          </div>
        </Container>
      </section>
    </div>
  );
}
