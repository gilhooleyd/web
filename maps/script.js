const apiKeyInput = document.getElementById('googleApiKey');
const restaurantNamesInput = document.getElementById('restaurantNames');
const findRestaurantsButton = document.getElementById('findRestaurants');
const resultsList = document.getElementById('resultsList');
const mapDiv = document.getElementById("map");
let markdown = "";

let apiKey = localStorage.getItem('apiKey');
if (apiKey) {
  apiKeyInput.value = apiKey;
}

function loadGoogleMapsThen(callback) {
  if (window.google && window.google.maps) {
    callback();
    return;
  }
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
  script.async = true;
  script.defer = true;
  script.onload = callback;
  script.onerror = () => {
    alert('Failed to load Google Maps API. Please check your API key and internet connection.');
  };
  document.head.appendChild(script);
}

findRestaurantsButton.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    alert('Please enter your Google API Key.');
    return;
  }
  localStorage.setItem("apiKey", apiKey);

  const restaurantNames = restaurantNamesInput.value.split('\n').map(name => name.trim());
  if (!restaurantNames || restaurantNames.length === 0 || (restaurantNames.length === 1 && restaurantNames[0] === "")) {
    alert('Please enter restaurant names.');
    return;
  }

  resultsList.innerHTML = ''; // Clear previous results

  loadGoogleMapsThen(() => { fetchRestaurantData(restaurantNames); });
});

function displayResult(placeId, restaurantName, rating, reviewCount) {
  const resultItem = document.createElement('li');
  const link = `https://www.google.com/maps/search/?api=1&query=<address>&query_place_id=${placeId}`;
  resultItem.classList.add('bg-white', 'rounded-md', 'shadow-sm', 'p-4', 'flex', 'justify-between', 'items-center');
  resultItem.innerHTML = `
<div>
  <h3 class="text-lg font-semibold text-gray-800"> <a target="_blank" href="${link}">${restaurantName}</a></h3>
  <p class="text-sm text-gray-500">Rating: ${rating}</p>
  <p class="text-sm text-gray-500">Reviews: ${reviewCount}</p>
</div>
`;
  markdown += `| [${restaurantName}](${link}) | ${rating} | ${reviewCount} | \n`;
  resultsList.appendChild(resultItem);
}

function displayError(text) {
  const resultItem = document.createElement('li');
  resultItem.classList.add('bg-white', 'rounded-md', 'shadow-sm', 'p-4', 'text-gray-600');
  resultItem.textContent = text;
  resultsList.appendChild(resultItem);
}

function fetchRestaurantData(restaurantNames) {
  const placesService = new google.maps.places.PlacesService(mapDiv);
  restaurantNames.forEach(async (restaurantName) => {
    try {
      // 1. Text Search
      const textSearchRequest = {
        query: restaurantName,
        type: 'restaurant'
      };

      placesService.textSearch(textSearchRequest, (results, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || results.length == 0) {
          displayError(`No results found for ${restaurantName}`);
          return;
        }
        const placeId = results[0].place_id;
        const restaurantName = results[0].name;

        // 2. Place Details
        const placeDetailsRequest = {
          placeId: placeId,
          fields: ['rating', 'user_ratings_total', 'geometry']
        };

        placesService.getDetails(placeDetailsRequest, (place, detailsStatus) => {
          if (detailsStatus !== google.maps.places.PlacesServiceStatus.OK) {
            displayError(`No details found for ${restaurantName}`);
            return
          }
          const rating = place.rating || 'N/A';
          const reviewCount = place.user_ratings_total ? place.user_ratings_total : 'N/A';
          displayResult(placeId, restaurantName, rating, reviewCount);

        });
      });
    } catch (error) {
      console.error('Error:', error);
      displayError(`Error fetching data for ${restaurantName}: ${error.message}`);
    }
  });
}
