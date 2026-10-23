// What counts as proof of ownership depends on what is being registered.
// A phone has an IMEI on its box and screen; a laptop has a serial sticker;
// a vehicle has a licence, customs papers and a VIN plate. Each device
// category maps to a "proof group", and each group lists the documents an
// owner can upload and a short hint telling them where to find it.
//
// The same list is sent to the web app, so the upload screen and the server
// always agree on what is accepted.

const TYPES = {
  receipt: {
    label: 'Purchase receipt or invoice',
    hint: 'From the shop or seller, showing the item and ideally its serial / IMEI number.',
  },
  box_label: {
    label: 'Photo of the box label',
    hint: 'The sticker on the original box that shows the IMEI or serial number.',
  },
  imei_screen: {
    label: 'Screenshot of the IMEI screen',
    hint: 'Dial *#06# or open Settings → About phone, then take a screenshot.',
  },
  serial_label: {
    label: 'Photo of the serial-number sticker',
    hint: 'Usually under the device, behind the battery or on the back panel.',
  },
  system_screen: {
    label: 'Screenshot of the system information screen',
    hint: 'The settings page that shows the serial number (for example Settings → About, or System Information).',
  },
  warranty: {
    label: 'Warranty card or registration',
    hint: 'A warranty card, or the manufacturer’s product registration showing your name.',
  },
  vehicle_licence: {
    label: 'Vehicle licence or registration certificate',
    hint: 'The vehicle licence / registration papers issued by the licensing office.',
  },
  ownership_certificate: {
    label: 'Proof of ownership certificate',
    hint: 'The proof of ownership certificate in your name.',
  },
  customs_papers: {
    label: 'Customs clearance papers',
    hint: 'For imported vehicles: customs duty papers showing the chassis / VIN.',
  },
  vin_photo: {
    label: 'Photo of the VIN or chassis number',
    hint: 'The VIN plate (dashboard or door frame) or the chassis number stamped on the frame.',
  },
  sale_agreement: {
    label: 'Sale agreement',
    hint: 'A signed agreement from the person or dealer who sold it to you.',
  },
  appraisal_certificate: {
    label: 'Certificate of authenticity or appraisal',
    hint: 'From the jeweller or an appraiser, describing the item.',
  },
  photo_with_item: {
    label: 'Photo of you with the item',
    hint: 'A clear photo showing you holding the item and any engraving or marks.',
  },
  other: {
    label: 'Other document',
    hint: 'Anything else that shows the item is yours. Add a short note explaining it.',
  },
};

const GROUPS = {
  phone: {
    name: 'Phones and tablets',
    types: ['receipt', 'box_label', 'imei_screen', 'warranty', 'other'],
  },
  computer: {
    name: 'Laptops and computers',
    types: ['receipt', 'serial_label', 'system_screen', 'box_label', 'warranty', 'other'],
  },
  watch: {
    name: 'Smart watches and wearables',
    types: ['receipt', 'box_label', 'system_screen', 'serial_label', 'warranty', 'other'],
  },
  vehicle: {
    name: 'Cars, motorcycles and other vehicles',
    types: ['vehicle_licence', 'ownership_certificate', 'customs_papers', 'vin_photo', 'sale_agreement', 'receipt', 'other'],
  },
  electronics: {
    name: 'Electronics (cameras, consoles, TVs, audio, appliances)',
    types: ['receipt', 'serial_label', 'box_label', 'system_screen', 'warranty', 'other'],
  },
  jewelry: {
    name: 'Jewellery and valuables',
    types: ['receipt', 'appraisal_certificate', 'photo_with_item', 'other'],
  },
  other: {
    name: 'Other items',
    types: ['receipt', 'serial_label', 'warranty', 'photo_with_item', 'other'],
  },
};

// Category names used by the registry and the registration form
const CATEGORY_TO_GROUP = {
  mobile_phone: 'phone', smartphone: 'phone', phone: 'phone', mobile: 'phone', tablet: 'phone',
  computer: 'computer', computers: 'computer', laptop: 'computer', desktop: 'computer',
  smart_watch: 'watch', smartwatch: 'watch', watch: 'watch', wearable: 'watch',
  vehicle: 'vehicle', car: 'vehicle', motorcycle: 'vehicle', bike: 'vehicle', truck: 'vehicle', tricycle: 'vehicle',
  electronics: 'electronics', camera: 'electronics', console: 'electronics', tv: 'electronics',
  headphones: 'electronics', earbuds: 'electronics', speaker: 'electronics', appliance: 'electronics',
  jewelry: 'jewelry', jewellery: 'jewelry',
};

function groupFor(category) {
  const key = String(category || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return CATEGORY_TO_GROUP[key] || 'other';
}

// [{ key, label, hint }] accepted for a device of this category
function typesFor(category) {
  const group = GROUPS[groupFor(category)];
  return group.types.map((key) => ({ key, ...TYPES[key] }));
}

function isAllowed(category, type) {
  return GROUPS[groupFor(category)].types.includes(type);
}

function labelOf(type) {
  return (TYPES[type] && TYPES[type].label) || 'Document';
}

module.exports = { TYPES, GROUPS, groupFor, typesFor, isAllowed, labelOf };
