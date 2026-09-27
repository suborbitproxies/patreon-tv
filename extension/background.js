// The toolbar button opens patreon.com as the TV app in a new tab.
chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: 'https://www.patreon.com/home#tv' });
});
