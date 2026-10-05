// Builds two fictional GTM exports (web + server) for "Skyline Charters".
// Every name, ID and token here is invented for the sample and tests.
import { writeFileSync } from 'node:fs';
const T = (key, value) => ({ type: 'TEMPLATE', key, value });
const B = (key, value) => ({ type: 'BOOLEAN', key, value: String(value) });
const map = rows => ({ type: 'LIST', key: rows.key, list: rows.items.map(([k, v]) => ({ type: 'MAP', map: [T(rows.k || 'parameter', k), T(rows.v || 'parameterValue', v)] })) });
const cond = (type, arg0, arg1) => ({ type, parameter: [T('arg0', arg0), T('arg1', arg1)] });
const meta = { accountId: '6100000001', containerId: '170000001' };

const SST = 'https://sst.skylinecharters.com';
const STAPE = 'https://skyln.us.stape.io';
const web = {
  exportFormatVersion: 2, exportTime: '2026-10-01 09:12:00',
  containerVersion: {
    ...meta, containerVersionId: '42', name: 'v42 - checkout events',
    container: { ...meta, name: 'skylinecharters.com', publicId: 'GTM-SKY7Q2L', usageContext: ['WEB'] },
    folder: [{ folderId: '90', name: 'GA4' }, { folderId: '91', name: 'Meta' }, { folderId: '92', name: 'Google Ads' }],
    tag: [
      { tagId: '1', name: 'GA4 - Config', type: 'googtag', parentFolderId: '90', firingTriggerId: ['2147479573'],
        parameter: [T('tagId', 'G-SKY4H7Q2LP'), map({ key: 'configSettingsTable', items: [['server_container_url', SST], ['send_page_view', 'true']] })] },
      { tagId: '2', name: 'GA4 - purchase', type: 'gaawe', parentFolderId: '90', firingTriggerId: ['20'],
        parameter: [T('eventName', 'purchase'), T('measurementIdOverride', '{{CONST - GA4 ID}}'), map({ key: 'eventSettingsTable', items: [['value', '{{DLV - value}}'], ['transaction_id', '{{DLV - transaction_id}}'], ['coupon', '{{DLV - coupon}}']] })] },
      { tagId: '3', name: 'GA4 - generate_lead', type: 'gaawe', parentFolderId: '90', firingTriggerId: ['21'],
        parameter: [T('eventName', 'generate_lead'), T('measurementIdOverride', '{{CONST - GA4 ID}}')] },
      { tagId: '4', name: 'GA4 - add_to_cart', type: 'gaawe', parentFolderId: '90', firingTriggerId: ['22'],
        parameter: [T('eventName', ''), T('measurementIdOverride', '{{CONST - GA4 ID}}')] },
      { tagId: '5', name: 'GA4 - Quote Requested', type: 'gaawe', firingTriggerId: ['23'],
        parameter: [T('eventName', 'Quote Requested'), T('measurementIdOverride', '{{CONST - GA4 ID}}')] },
      { tagId: '6', name: 'Data Tag - page_view', type: 'cvt_MBTSV', firingTriggerId: ['2147479553'],
        parameter: [T('event_type', 'standard'), T('event_name_standard', 'page_view'), T('gtm_server_domain', STAPE), T('request_path', '/data')] },
      { tagId: '7', name: 'Data Tag - purchase', type: 'cvt_MBTSV', firingTriggerId: ['20'],
        parameter: [T('event_type', 'standard'), T('event_name_standard', 'purchase'), T('gtm_server_domain', STAPE), T('request_path', '/data'), T('user_data', '{{DLV - email}}')] },
      { tagId: '8', name: 'Data Tag - add_to_cart', type: 'cvt_MBTSV', firingTriggerId: ['22'],
        parameter: [T('event_type', 'standard'), T('event_name_standard', 'add_to_cart'), T('gtm_server_domain', STAPE), T('request_path', '/data')] },
      { tagId: '9', name: 'Data Tag - quote_requested', type: 'cvt_MBTSV', firingTriggerId: ['23'],
        parameter: [T('event_type', 'custom'), T('event_name_custom', 'quote_requested'), T('gtm_server_domain', STAPE), T('request_path', '/data')] },
      { tagId: '10', name: 'Meta Pixel - PageView', type: 'cvt_8840_12', parentFolderId: '91', firingTriggerId: ['2147479553'],
        parameter: [T('pixelId', '481920375512334'), T('eventName', 'PageView')] },
      { tagId: '11', name: 'Meta Pixel - Purchase', type: 'cvt_8840_12', parentFolderId: '91', firingTriggerId: ['20'],
        parameter: [T('pixelId', '481920375512334'), T('eventName', 'Purchase'), T('value', '{{DLV - value}}')] },
      { tagId: '12', name: 'Meta Pixel - Lead', type: 'cvt_8840_12', parentFolderId: '91', firingTriggerId: ['21'],
        parameter: [T('pixelId', '481920375512334'), T('eventName', 'Lead')] },
      { tagId: '13', name: 'Google Ads - Purchase', type: 'awct', parentFolderId: '92', firingTriggerId: ['20'],
        parameter: [T('conversionId', '907112233'), T('conversionLabel', 'Xk2fCLu8pZ0YEL'), T('conversionValue', '{{DLV - value}}'), T('orderId', '{{DLV - transaction_id}}')] },
      { tagId: '14', name: 'Google Ads - Lead', type: 'awct', parentFolderId: '92', firingTriggerId: ['21'],
        parameter: [T('conversionId', '907112233'), T('conversionLabel', '')] },
      { tagId: '15', name: 'Google Ads - Remarketing', type: 'sp', parentFolderId: '92', firingTriggerId: ['2147479553'],
        parameter: [T('conversionId', '907112233')] },
      { tagId: '16', name: 'Conversion Linker', type: 'gclidw', parentFolderId: '92', firingTriggerId: ['2147479553'], parameter: [] },
      { tagId: '17', name: 'LinkedIn Insight', type: 'html', firingTriggerId: ['2147479553'],
        parameter: [T('html', '<script>_linkedin_partner_id="5512093";</script><script src="https://snap.licdn.com/li.lms-analytics/insight.min.js"></script>')] },
      { tagId: '18', name: 'TikTok Pixel - Base', type: 'html', firingTriggerId: ['2147479553'],
        parameter: [T('html', '<script>!function(w,d,t){/* analytics.tiktok.com */}(window,document,"ttq");ttq.load("C9SKY2LQ1");ttq.page();</script>')] },
      { tagId: '19', name: 'TikTok Pixel - Base (copy)', type: 'html', firingTriggerId: ['2147479553'],
        parameter: [T('html', '<script>!function(w,d,t){/* analytics.tiktok.com */}(window,document,"ttq");ttq.load("C9SKY2LQ1");ttq.page();</script>')] },
      { tagId: '24', name: 'UA - Pageview (old)', type: 'ua', paused: true, firingTriggerId: ['2147479553'], parameter: [T('trackingId', 'UA-4401123-1')] },
      { tagId: '25', name: 'Hotjar', type: 'hjtc', firingTriggerId: ['2147479553'], parameter: [T('hotjar_site_id', '3301298')] },
      { tagId: '26', name: 'Meta Pixel - ViewContent', type: 'cvt_8840_12', parentFolderId: '91',
        parameter: [T('pixelId', '{{CONST - Meta Pixel ID}}'), T('eventName', 'ViewContent')] },
      { tagId: '27', name: 'Floodlight - Booking', type: 'fls', firingTriggerId: ['24'],
        parameter: [T('advertiserId', '10221344'), T('groupTag', 'skyln0'), T('activityTag', 'bookcf0'), T('ordinal', '{{DLV - transaction_id}}')] },
    ],
    trigger: [
      { triggerId: '20', name: 'CE - purchase', type: 'CUSTOM_EVENT', customEventFilter: [cond('EQUALS', '{{_event}}', 'purchase')] },
      { triggerId: '21', name: 'CE - generate_lead', type: 'CUSTOM_EVENT', customEventFilter: [cond('EQUALS', '{{_event}}', 'generate_lead')] },
      { triggerId: '22', name: 'CE - add_to_cart', type: 'CUSTOM_EVENT', customEventFilter: [cond('EQUALS', '{{_event}}', 'add_to_cart')] },
      { triggerId: '23', name: 'CE - quote_requested', type: 'CUSTOM_EVENT', customEventFilter: [cond('EQUALS', '{{_event}}', 'quote_requested')] },
      { triggerId: '24', name: 'PV - Booking Confirmed', type: 'PAGEVIEW', filter: [cond('EQUALS', '{{Page Hostname}}', 'staging.skylinecharters-dev.com'), cond('CONTAINS', '{{Page URL}}', '/booking/confirmed')] },
      { triggerId: '25', name: 'Click - Call Button', type: 'LINK_CLICK', filter: [cond('CONTAINS', '{{Click Classes}}', 'btn-call')] },
      { triggerId: '26', name: 'CE - purchase (copy)', type: 'CUSTOM_EVENT', customEventFilter: [cond('EQUALS', '{{_event}}', 'purchase')] },
    ],
    variable: [
      { variableId: '30', name: 'DLV - value', type: 'v', parameter: [T('name', 'ecommerce.value'), T('dataLayerVersion', '2')] },
      { variableId: '31', name: 'DLV - transaction_id', type: 'v', parameter: [T('name', 'ecommerce.transaction_id'), T('dataLayerVersion', '2')] },
      { variableId: '32', name: 'DLV - email', type: 'v', parameter: [T('name', 'user_data.email'), T('dataLayerVersion', '2')] },
      { variableId: '33', name: 'CONST - GA4 ID', type: 'c', parameter: [T('value', 'G-SKY4H7Q2LP')] },
      { variableId: '34', name: 'CONST - Meta Pixel ID', type: 'c', parameter: [T('value', '481920375512334')] },
      { variableId: '35', name: 'DLV - route_id', type: 'v', parameter: [T('name', ''), T('dataLayerVersion', '2')] },
      { variableId: '36', name: 'DLV - order_value', type: 'v', parameter: [T('name', 'ecommerce.value'), T('dataLayerVersion', '2')] },
      { variableId: '37', name: 'JS - Old Cart Total', type: 'jsm', parameter: [T('javascript', 'function(){return window.cartTotal;}')] },
    ],
    builtInVariable: [
      { type: 'PAGE_URL', name: 'Page URL' }, { type: 'PAGE_HOSTNAME', name: 'Page Hostname' }, { type: 'EVENT', name: 'Event' }, { type: 'CLICK_CLASSES', name: 'Click Classes' },
    ],
  },
};

const server = {
  exportFormatVersion: 2, exportTime: '2026-10-01 09:20:00',
  containerVersion: {
    accountId: '6100000001', containerId: '170000002', containerVersionId: '18', name: 'v18',
    container: { accountId: '6100000001', containerId: '170000002', name: 'Skyline - Server', publicId: 'GTM-SKYSRV9', usageContext: ['SERVER'] },
    client: [
      { clientId: '1', name: 'GA4', type: 'gaaw_client', priority: 10, parameter: [B('activateDefaultPaths', true)] },
      { clientId: '2', name: 'Data Client', type: 'cvt_175099610_97', priority: 5, parameter: [T('path', '/data')] },
      { clientId: '3', name: 'Web Container', type: 'gtm_client', priority: 1, parameter: [T('allowedContainerIds', 'GTM-SKY7Q2L')] },
    ],
    tag: [
      { tagId: '50', name: 'GA4 - Forward All', type: 'sgtmgaaw', firingTriggerId: ['60'], parameter: [T('redactVisitorIp', 'false')] },
      { tagId: '51', name: 'Meta CAPI - PageView', type: 'cvt_175099610_19', firingTriggerId: ['61', '64'],
        parameter: [T('pixelId', '{{CONST - Meta Pixel ID}}'), T('accessToken', '{{CONST - Meta Access Token}}'), T('eventName', 'PageView')] },
      { tagId: '52', name: 'Meta CAPI - Purchase', type: 'cvt_175099610_19', firingTriggerId: ['62'],
        parameter: [T('pixelId', '{{CONST - Meta Pixel ID}}'), T('accessToken', '{{CONST - Meta Access Token}}'), T('eventName', 'Purchase')] },
      { tagId: '53', name: 'Meta CAPI - Lead', type: 'cvt_175099610_19', firingTriggerId: ['63'],
        parameter: [T('pixelId', '{{CONST - Meta Pixel ID}}'), T('accessToken', '{{CONST - Meta Access Token}}'), T('eventName', 'Lead')] },
      { tagId: '54', name: 'TikTok Events API - Purchase', type: 'cvt_201144_7', paused: true, firingTriggerId: ['62'], parameter: [T('accessToken', '{{CONST - TikTok Token}}')] },
    ],
    trigger: [
      { triggerId: '60', name: 'All GA4 Events', type: 'ALWAYS', filter: [cond('EQUALS', '{{Client Name}}', 'GA4')] },
      { triggerId: '61', name: 'Data - page_view', type: 'ALWAYS', filter: [cond('EQUALS', '{{ED - Event Name}}', 'page_view')] },
      { triggerId: '62', name: 'Data - purchase', type: 'ALWAYS', filter: [cond('MATCH_REGEX', '{{ED - Event Name}}', '^(purchase|checked_out)$')] },
      { triggerId: '63', name: 'Lead - CompleteRegistration', type: 'ALWAYS', filter: [cond('EQUALS', '{{Event Name}}', 'CompleteRegistration')] },
      { triggerId: '64', name: 'GA4 page_view', type: 'ALWAYS', filter: [cond('EQUALS', '{{Event Name}}', 'page_view')] },
      { triggerId: '65', name: 'Debug - everything', type: 'ALWAYS', filter: [cond('MATCH_REGEX', '{{Event Name}}', '.+')] },
    ],
    variable: [
      { variableId: '70', name: 'ED - Event Name', type: 'ed', parameter: [T('keyPath', 'event_name')] },
      { variableId: '71', name: 'CONST - Meta Pixel ID', type: 'c', parameter: [T('value', '481920375512334')] },
      { variableId: '72', name: 'CONST - Meta Access Token', type: 'c', parameter: [T('value', 'EAAGsk2xFakeSampleToken000000000000')] },
      { variableId: '73', name: 'CONST - TikTok Token', type: 'c', parameter: [T('value', 'tt_sample_token_0000')] },
      { variableId: '74', name: 'ED - user_agent', type: 'ed', parameter: [T('keyPath', 'user_agent')] },
    ],
    builtInVariable: [{ type: 'EVENT_NAME', name: 'Event Name' }, { type: 'CLIENT_NAME', name: 'Client Name' }],
  },
};
writeFileSync(new URL('./sample-web.json', import.meta.url), JSON.stringify(web, null, 1));
writeFileSync(new URL('./sample-server.json', import.meta.url), JSON.stringify(server, null, 1));
console.log('ok', web.containerVersion.tag.length, server.containerVersion.tag.length);
