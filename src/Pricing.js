/**
 * Pricing engine. Given a service + variant + submission, returns one of:
 *   { status: 'ok', total, downpayment, remaining, peopleDisplay, lineDescription }
 *   { status: 'clarify', missing: ['…', …] }   — ask the guest, no invoice
 *   { status: 'review',  reason: '…' }         — flag for the owner, no invoice
 *
 * Golden rule: never guess. Anything under-specified or ambiguous falls
 * through to 'clarify' (guest can answer) or 'review' (owner must decide).
 */
function priceSubmission(service, variant, sub) {
  const pricing = variant.pricing;
  const commission = variant.commission || service.commission || { type: 'unknown' };

  if (pricing.type === 'quote') {
    return { status: 'review', reason: 'No price on file — personal follow-up promised to guest.' };
  }
  if (pricing.type === 'review') {
    return { status: 'review', reason: pricing.reason };
  }

  let total = null;
  const missing = [];
  let peopleDisplay = sub.partySize != null ? String(sub.partySize) : '';

  switch (pricing.type) {
    case 'flat':
    case 'perVehicle':
      total = pricing.price;
      break;

    case 'perPerson':
      if (sub.partySize == null) {
        missing.push('how many people will be joining');
      } else {
        total = round2_(pricing.price * sub.partySize);
      }
      break;

    case 'adultChild': {
      const b = sub.partyBreakdown || {};
      if (b.adults == null && b.children == null) {
        missing.push('how many adults and how many children are in your party');
      } else {
        total = round2_(pricing.adult * (b.adults || 0) + pricing.child * (b.children || 0));
        peopleDisplay = partyDisplay_(b);
        if (total === 0) missing.push('how many adults and how many children are in your party');
      }
      break;
    }

    case 'perHour': {
      if (sub.hours == null) {
        missing.push('how many hours you would like (' + pricing.minHours + '–' + pricing.maxHours + ' hours)');
      } else if (sub.hours < pricing.minHours || sub.hours > pricing.maxHours) {
        missing.push('a duration between ' + pricing.minHours + ' and ' + pricing.maxHours + ' hours');
      } else if (pricing.over4Rate && sub.hours > 4) {
        // Two-rate structure ($X/h up to 4h, $Y/h beyond) — the sheet doesn't
        // say whether the lower rate applies to all hours or only extra ones.
        return { status: 'review', reason: 'Requested ' + sub.hours + ' hours; the >4-hour rate structure is ambiguous in the info sheet.' };
      } else {
        total = round2_(pricing.rate * sub.hours);
      }
      break;
    }

    case 'tieredPerPerson': {
      if (sub.partySize == null) {
        missing.push('how many people will be joining');
      } else {
        const tier = pricing.tiers.find(t => sub.partySize >= t.min && sub.partySize <= t.max);
        if (!tier) {
          const min = Math.min.apply(null, pricing.tiers.map(t => t.min));
          return { status: 'review', reason: 'Party of ' + sub.partySize + ' is outside the priced range (minimum ' + min + ').' };
        }
        total = round2_(tier.price * sub.partySize);
      }
      break;
    }

    case 'groupFormula': {
      if (sub.partySize == null) {
        missing.push('how many people will be joining (up to ' + pricing.maxPeople + ')');
      } else if (sub.partySize > pricing.maxPeople) {
        return { status: 'review', reason: 'Party of ' + sub.partySize + ' exceeds the maximum of ' + pricing.maxPeople + '.' };
      } else {
        total = round2_(pricing.base + Math.max(0, sub.partySize - pricing.included) * pricing.extraPerPerson);
      }
      break;
    }

    default:
      return { status: 'review', reason: 'Unknown pricing type "' + pricing.type + '" in catalog.' };
  }

  // Vehicle-capacity sanity check: don't invoice a 2-seater for a party of 6.
  if (total != null && service.partySizeIsVehicleCapacity && variant.seats && sub.partySize != null
      && sub.partySize > variant.seats) {
    missing.push('a vehicle choice that fits your party of ' + sub.partySize +
      ' (the ' + variant.name + ' seats ' + variant.seats + ') — or let us know how many vehicles you need');
    total = null;
  }

  if (missing.length) return { status: 'clarify', missing: missing };

  const downpayment = computeDownpayment_(commission, total, sub);
  if (downpayment == null) {
    return { status: 'review', reason: 'Downpayment (commission) is not defined for this service in the info sheet.' };
  }
  if (downpayment > total) {
    return { status: 'review', reason: 'Computed downpayment ($' + downpayment + ') exceeds the total ($' + total + ') — check catalog.' };
  }

  return {
    status: 'ok',
    total: total,
    downpayment: downpayment,
    remaining: round2_(total - downpayment),
    peopleDisplay: peopleDisplay,
    lineDescription: service.name === variant.name ? service.name : service.name + ' — ' + variant.name
  };
}

/** Downpayment = Aqua Lux's commission, per Josh's rule. */
function computeDownpayment_(commission, total, sub) {
  switch (commission.type) {
    case 'pct':
      return round2_(total * commission.value);
    case 'flat':
      return round2_(commission.value);
    case 'flatPerPerson':
      if (sub.partySize == null) return null;
      return round2_(commission.value * sub.partySize);
    case 'pctPlusPerPerson':
      if (sub.partySize == null) return null;
      return round2_(total * commission.pct + commission.perPerson * sub.partySize);
    default:
      return null;
  }
}

function partyDisplay_(breakdown) {
  const parts = [];
  if (breakdown.adults != null) parts.push(breakdown.adults + ' adult' + (breakdown.adults === 1 ? '' : 's'));
  if (breakdown.children != null && breakdown.children > 0) parts.push(breakdown.children + ' child' + (breakdown.children === 1 ? '' : 'ren'));
  return parts.join(', ') || (breakdown.total != null ? String(breakdown.total) : '');
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function money_(n) {
  return '$' + Number(n).toFixed(2);
}
