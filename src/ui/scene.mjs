const adult = [
  '<g class="person-a">',
  '<path d="M266 340 253 422l-28 34" stroke="#493c72" stroke-width="32" stroke-linecap="round" fill="none"/>',
  '<path d="m300 340 24 62 37 34" stroke="#493c72" stroke-width="32" stroke-linecap="round" fill="none"/>',
  '<path d="m224 454-15 7 32 2m120-27 19 13-31-1" stroke="#fff8ec" stroke-width="20" stroke-linecap="round" fill="none"/>',
  '<path d="m254 257-56-40-21-64m127 101 44-45 17-59" stroke="#f47d5b" stroke-width="35" stroke-linecap="round" fill="none"/>',
  '<path d="m177 153-8-23m196 20 6-22" stroke="#f6caa9" stroke-width="26" stroke-linecap="round" fill="none"/>',
  '<path d="M249 248q29-21 58 0l14 99q-42 18-83 0z" fill="#f47d5b"/>',
  '<path d="m257 280 48-9m-49 30 50-10" stroke="#ffc5a6" stroke-width="8" stroke-linecap="round"/>',
  '<rect x="265" y="219" width="28" height="31" rx="12" fill="#f6caa9"/>',
  '<ellipse cx="279" cy="199" rx="37" ry="41" fill="#f8d6bb"/>',
  '<path d="M243 202q-14-54 29-56 53-11 47 45-18 0-35-19-11 27-41 30" fill="#463650"/>',
  '<path d="M268 201v4m23-4v4" stroke="#463650" stroke-width="4" stroke-linecap="round"/>',
  '<path d="M271 216q8 8 16 0" stroke="#b86b63" stroke-width="3" stroke-linecap="round" fill="none"/>',
  '</g>'
].join('');
const child = [
  '<g class="person-b">',
  '<path d="m446 368-13 58-27 21m64-79 25 45 12 28" stroke="#4a7774" stroke-width="27" stroke-linecap="round" fill="none"/>',
  '<path d="m405 448-13 9 27 1m88-17 16 10-28 1" stroke="#fff8ec" stroke-width="18" stroke-linecap="round" fill="none"/>',
  '<path d="m435 295-40-27-12-40m92 70 38-23 31-48" stroke="#73bfa9" stroke-width="29" stroke-linecap="round" fill="none"/>',
  '<path d="m383 228-3-19m164 18 10-14" stroke="#f6caa9" stroke-width="22" stroke-linecap="round" fill="none"/>',
  '<path d="M433 288q25-15 46 2l9 82q-32 15-65-1z" fill="#73bfa9"/>',
  '<path d="m453 311 7 13 15 3-11 10 2 15-13-7-13 6 3-14-10-11 15-2z" fill="#e8f4d2"/>',
  '<rect x="445" y="263" width="23" height="29" rx="10" fill="#f6caa9"/>',
  '<circle cx="457" cy="245" r="31" fill="#f8d6bb"/>',
  '<path d="M428 241q-14-38 18-38 41-14 44 34-20-2-33-16-6 20-29 20" fill="#725346"/>',
  '<path d="M447 245v3m20-3v3" stroke="#463650" stroke-width="4" stroke-linecap="round"/>',
  '<path d="M450 258q6 6 12 0" stroke="#b86b63" stroke-width="3" stroke-linecap="round" fill="none"/>',
  '</g>'
].join('');
export function scene(players = 2, bubbles = true) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" class="scene-art" viewBox="0 0 740 530" role="img" aria-label="伸手拍泡泡的家庭插画">',
    '<defs><radialGradient id="orb"><stop stop-color="#fff" stop-opacity=".75"/><stop offset=".65" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".6"/></radialGradient></defs>',
    '<ellipse cx="365" cy="466" rx="253" ry="36" fill="#a998d7" opacity=".28"/>',
    '<path d="M80 457q285-75 580 0" stroke="#fff" stroke-width="2" fill="none" opacity=".5"/>',
    '<path d="M146 408q-70-119 0-217m460 210q68-113 14-194" stroke="#fff" stroke-width="2" stroke-dasharray="5 13" fill="none" opacity=".6"/>',
    players === 1 ? '<g transform="translate(88 0)">' + adult + '</g>' : adult + child,
    bubbles ? '<g fill="url(#orb)" stroke="#fff" stroke-opacity=".8" stroke-width="2"><circle cx="355" cy="93" r="58"/><circle cx="137" cy="257" r="34"/><circle cx="588" cy="157" r="38"/><circle cx="565" cy="370" r="23"/></g><path d="M319 78q5-22 27-26m221 93q4-11 14-14" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none"/><path d="m355 76 4 12 12 5-12 4-4 13-5-13-12-4 12-5z" fill="#fff"/>' : '',
    '<g fill="#f5dc81"><path d="m204 85 5 15 15 5-15 5-5 15-5-15-15-5 15-5z"/><circle cx="631" cy="301" r="6"/><circle cx="99" cy="168" r="5"/></g>',
    '<g stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="m539 95 7-8m-14 1 1-10m-3 213 10 1m-7 7 2-11"/></g>',
    '</svg>'
  ].join('');
}
