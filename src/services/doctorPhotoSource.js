const PUBLIC_PHOTO_BASE = 'https://sriaas-frappe-test.s3.ap-south-1.amazonaws.com/doctor/';

// CRM credentials must only accompany requests to the CRM itself.
function doctorPhotoSource(image, erpBaseUrl, erpHeaders) {
  const crm = new URL(erpBaseUrl);
  const url = new URL(String(image).trim(), crm);
  if (url.username || url.password) return null;
  if (url.origin === crm.origin && /^\/(private\/)?files\//.test(url.pathname)) {
    return { url, headers: erpHeaders };
  }
  const publicBase = new URL(PUBLIC_PHOTO_BASE);
  if (url.origin === publicBase.origin && url.pathname.startsWith(publicBase.pathname)) {
    return { url, headers: {} };
  }
  return null;
}

module.exports = { doctorPhotoSource };
