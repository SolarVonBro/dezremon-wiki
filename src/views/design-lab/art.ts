// Placeholder pictures for the design lab (inline SVG, no files): the lab should look like a living world with
// portraits, landscapes and maps, without depending on any real images.
const uri = (svg: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)

export const landscape = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2347"/><stop offset=".55" stop-color="#6b2f5c"/><stop offset="1" stop-color="#e08a5a"/></linearGradient>
<radialGradient id="g" cx=".72" cy=".62" r=".35"><stop offset="0" stop-color="#ffd59a" stop-opacity=".9"/><stop offset="1" stop-color="#ffd59a" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="400" fill="url(#s)"/><rect width="1200" height="400" fill="url(#g)"/>
<circle cx="860" cy="250" r="46" fill="#ffe2b0"/>
<path d="M0 300 L140 190 L230 260 L360 150 L470 250 L560 200 L700 290 L820 210 L960 300 L1080 220 L1200 280 V400 H0Z" fill="#3b2446"/>
<path d="M0 330 L120 270 L260 330 L380 260 L520 340 L650 280 L780 340 L900 290 L1040 350 L1200 300 V400 H0Z" fill="#251832"/>
<path d="M0 370 Q300 330 600 365 T1200 355 V400 H0Z" fill="#150e1f"/>
<g fill="#150e1f"><path d="M180 352 l8 -40 l8 40z"/><path d="M200 356 l7 -30 l7 30z"/><path d="M990 350 l9 -44 l9 44z"/><path d="M1012 354 l7 -32 l7 32z"/></g>
</svg>`)

export const castle = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1230"/><stop offset="1" stop-color="#2c3a6b"/></linearGradient></defs>
<rect width="600" height="400" fill="url(#n)"/>
<g fill="#fff" opacity=".7"><circle cx="60" cy="50" r="1.4"/><circle cx="140" cy="90" r="1"/><circle cx="220" cy="40" r="1.2"/><circle cx="330" cy="70" r="1"/><circle cx="520" cy="40" r="1.3"/><circle cx="560" cy="110" r="1"/><circle cx="90" cy="140" r="1"/></g>
<circle cx="450" cy="90" r="38" fill="#f4ecd0"/><circle cx="465" cy="80" r="34" fill="#22305e" opacity=".35"/>
<path d="M0 330 Q150 260 260 280 L300 220 L420 300 Q520 270 600 300 V400 H0Z" fill="#141b38"/>
<g fill="#0a0f24"><rect x="230" y="160" width="26" height="100"/><path d="M226 160 l17 -34 l17 34z"/><rect x="262" y="190" width="70" height="70"/><rect x="336" y="140" width="30" height="120"/><path d="M332 140 l19 -40 l19 40z"/><rect x="290" y="170" width="18" height="30"/><path d="M286 170 l13 -24 l13 24z"/></g>
<g fill="#ffcf6b"><rect x="240" y="190" width="5" height="8"/><rect x="346" y="170" width="5" height="9"/><rect x="296" y="215" width="5" height="8"/><rect x="315" y="225" width="5" height="8"/></g>
<path d="M0 360 Q200 330 380 352 T600 345 V400 H0Z" fill="#070a18"/>
</svg>`)

export const forest = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fc6a0"/><stop offset="1" stop-color="#1f3a2b"/></linearGradient></defs>
<rect width="600" height="400" fill="url(#f)"/>
<g fill="#2e5a3f" opacity=".7"><path d="M40 300 l40 -150 l40 150z"/><path d="M150 300 l35 -130 l35 130z"/><path d="M420 300 l45 -170 l45 170z"/><path d="M520 300 l35 -120 l35 120z"/></g>
<g fill="#183324"><path d="M0 330 l55 -200 l55 200z"/><path d="M90 340 l50 -180 l50 180z"/><path d="M330 340 l60 -220 l60 220z"/><path d="M470 340 l55 -190 l55 190z"/></g>
<rect y="320" width="600" height="80" fill="#10241a"/>
<g fill="#f2d47a" opacity=".8"><circle cx="250" cy="250" r="2"/><circle cx="280" cy="270" r="1.5"/><circle cx="300" cy="240" r="2"/></g>
</svg>`)

export const mapArt = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice">
<rect width="800" height="500" fill="#2a5576"/>
<path d="M80 120 Q160 60 260 90 T430 70 Q560 50 640 120 T720 260 Q700 380 590 420 T380 440 Q240 460 160 400 T70 260 Q50 180 80 120Z" fill="#d8c79a"/>
<path d="M120 160 Q200 130 260 170 T380 160 Q470 140 540 190 T620 300 Q560 380 460 380 T280 380 Q180 360 140 300 T120 160Z" fill="#b9c48a"/>
<path d="M300 220 Q360 200 420 240 T520 260" stroke="#4d7fa5" stroke-width="5" fill="none"/>
<path d="M200 300 L250 250 L300 290 L350 230 L400 280" stroke="#8b7653" stroke-width="10" fill="none" stroke-linejoin="round" opacity=".6"/>
<g fill="#7c2f2a"><circle cx="300" cy="220" r="7"/><circle cx="470" cy="300" r="7"/><circle cx="220" cy="330" r="6"/></g>
<path d="M300 220 Q380 260 470 300" stroke="#7c2f2a" stroke-width="3" stroke-dasharray="8 7" fill="none"/>
</svg>`)

/** A bust in a hood/hair silhouette on a coloured background — `hue` picks the palette. */
export function portrait(hue: number, hood = false) {
  const bg1 = `hsl(${hue} 45% 32%)`, bg2 = `hsl(${(hue + 30) % 360} 50% 16%)`, skin = `hsl(${(hue + 20) % 360} 30% 72%)`, cloth = `hsl(${hue} 40% 22%)`
  return uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<defs><radialGradient id="b" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient></defs>
<rect width="200" height="200" fill="url(#b)"/>
<path d="M30 200 Q40 140 100 132 Q160 140 170 200Z" fill="${cloth}"/>
${hood ? `<path d="M52 120 Q50 40 100 34 Q150 40 148 120 Q140 150 100 150 Q60 150 52 120Z" fill="${cloth}"/>` : `<path d="M60 96 Q56 46 100 42 Q144 46 140 96 Q136 70 100 66 Q64 70 60 96Z" fill="hsl(${(hue + 200) % 360} 25% 18%)"/>`}
<ellipse cx="100" cy="98" rx="30" ry="36" fill="${skin}"/>
<path d="M86 96 h8 M106 96 h8" stroke="hsl(${hue} 20% 25%)" stroke-width="3" stroke-linecap="round"/>
</svg>`)
}
