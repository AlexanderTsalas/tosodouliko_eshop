  
![][image1]

1. ###### **Set up**

2. **Environments**

# **API Integration**

Partner API (1.65)

3. ###### **Requesting a Delivery (Process)**

   1. Authentication */auth-sessions*

   2. (Optional) List all available origins */origins*

   3. (Optional) List all available destinations */destinations*

   4. Request a delivery */delivery-requests*

   5. (Optional) Modify your delivery request */delivery-requests/{id}*

   6. Fetch a shipping label */parcels/{id}/label.{type}*

   7. Cancel parcel delivery /api/v1/parcels/{id}:cancel

   8. (Optional) Find closest locker /api/v2/delivery-requests:checkAddressDelivery

4. ###### **Destination Map (Widget/Custom)**

   1. Widget Integration

5. ###### **Troubleshooting (Error Codes)**

6. **Appendix (API Endpoints)**

   1. Authentication

   2. Locations

   3. Delivery Requests

   4. Labels

   5. Parcels

   6. Delivery Partners

1. # Set up

To use our API, you must first **register your company with our sales team**. To do that, reach out to us at [**sales@boxnow.gr**](mailto:sales@boxnow.gr) with the following information:

* **Company name, Address, Tax ID & Contact details (for customers)**. Examples: [info@boxnow.gr](mailto:info@boxnow.gr), phone number (e.g. 210-1234567)

* **Phone numbers** of users that will have access to the Partner Portal system. We will use these numbers for 'One Time Password' (OTP) SMS authentications during log-in.

* **All addresses of pickup points** where we will be picking up your orders for delivery. Examples: Warehouses, Stores etc.

After you are successfully registered, you will receive the following:

**OAUTH\_CLIENT\_ID**

Keep this value private and safe\! This is your OAuth2 Client ID that you will use to authenticate with the Partner API.

**OAUTH\_CLIENT\_SECRET**

Keep this value private and safe\! This is your OAuth2 Client Secret that you will use to authenticate with the Partner API.

**API\_URL**

This is your Base URL for the Partner API, to which you will then append the relevant endpoint paths.

2. # Environments

   ###### **Stage (Sandbox)**

   An environment with limited functionalities, where you can test the integration.

   ###### **Production**

   Use this environment with **caution**, as it is *live* and connected to real end-users.

3. # Requesting a Delivery (Process)

Follow these steps to successfully request a delivery and perform other related actions:

1. Authentication */auth-sessions*

   Authentication is based on OAuth 2.0 standard, Client Credentials grant. Client ID and Secret **MUST** be passed to you from BoxNow support in advance

   In order to use the API, you **must attach the access token to Authorization header as a Bearer token**.

   See an example of a successful integration:

###### **POST /api/v1/auth-sessions**

![][image2]

###### **Status Code 200**

\*More information on Appendix 6.1.

2. #### (Optional) List all available origins (Optional) */origins*

   This call will list all available pick-up points locations where BOX NOW can pick up all your parcels from – typically your warehouses.

   You can list all your warehouses using */origins API* call, which has the same parameters as */destinations API* call where you do not specify parameters

   latlng, radius or requiredSize, but you specify locationType as “warehouse”. You refer to this location by its ID (locationId).

   Moreover there is one specific location called Any APM that can be listed by the same way and using locationType as “any-apm”, it returns just one location – any-apm with ID: 2\. You can refer to it by its ID (locationId). Usage of this will be explained in the next section.

   For better performance for this particular call you should use the following API-url’s not the ones provided with your credentials:

   **Sandbox/Stage**: [*https://locationapi-stage.boxnow.gr/api/v1/origins*](https://locationapi-stage.boxnow.gr/api/v1/origins)

   **Production**: [*https://locationapi-production.boxnow.gr/api/v1/origins*](https://locationapi-production.boxnow.gr/api/v1/origins)

   Below is the parameter available for you to filter all Origin locations:

| Name | Type | Description |
| ----- | ----- | ----- |
|  lating |  String |  If applied, only locations in the specified radius from this gps coordinate, are returned |
|  radius |  Number |  Radius in meters to return only locations within selected radius from given GPS location. Ignored if latlng is not present. Default value : 25000 |
|  requiredSize |  array\[string\] |  Return only locations with given types. If not present, filter is not applied. Available values : apm, any-apm, warehouse, depot |

|  locationType |  string |  Return only locations with given a type. If not present, filter is not applied. Available values: any-apm, warehouse, depot |
| :---- | ----- | :---- |

See an example of a successful integration:

###### **GET /api/v1/origins**

###### **Status Code 200**

3. (Optional) List all available destinations*/destinations*

This call will list all available APM (**A**utomatic **P**arcel **M**achine) locations where we can deliver your parcel to.

For better performance for this particular call you should use the following API-url’s not the ones provided with your credentials:

**Sandbox/Stage**: [*https://locationapi-stage.boxnow.gr/api/v1/destinations*](https://locationapi-stage.boxnow.gr/api/v1/destinations)

**Production**: [*https://locationapi-production.boxnow.gr/api/v1/destinations*](https://locationapi-production.boxnow.gr/api/v1/destinations)

Below are the parameters available for you to filter all APM locations:

| Name | Type | Description |
| ----- | ----- | ----- |
|  latlng |  string |  If applied, only locations in the specified radius from these gps coordinates are returned. Example: 48.78081955454138,12.446962472 273063 |
|  radius |  number | Radius in meters to return only locations within a selected radius from given GPS location. Ignored if **latlng** is not present. Example: 1000 Default Value: 25000 |
|  requiredSize |  number |  Return only locations that can accept a package of your **requiredSize**. Example: 1 |

|  locationType |  array\[string\] |  Return only locations with given a type. If not present, filter is not applied. Available values : apm, any-apm, warehouse, depot |
| :---- | :---- | :---- |

See an example of a successful integration:

###### **GET /api/v1/destinations**

###### **Status Code 200**

Alternatively, refer to ***section 4*** for a JavaScript snippet you can embed into your web to display all available APMs via a pop-up / iframe widget, or for a brief description of a successful custom map integration.

###### **id**

When requesting a delivery, you will refer to these records by **id** – More commonly:

###### **locationId**

4. Request a delivery */delivery-requests*

   Use this call to order a delivery of a parcel (or multiple parcels).

   This is *the main call* you will be using to create any type of delivery requests. Once a **successful request** for delivery is made:

   * (optional) We will send you an email notifying you of a successful delivery request creation with a PDF label attached. Parameter *notifyOnAccepted* needs to be populated for this function (See

     ###### **Appendix 6.3**).

     * (Described below) Alternatively, you should fetch the PDF label for each parcel using the GET **/parcels/{id}/label.pdf** call, print it and stick it to the parcel(s).

     * We will send a courier to pick up the parcel(s) at the agreed pick-up times.

     * We will also notify the customer that:

1. we have received a delivery order and that a parcel will be delivered to them.

2. we have successfully delivered their parcel(s) to the specified destination APM, with the necessary details for collecting the parcel(s).

   ###### **See an example of a delivey-request with all the required fields:**

**POST /api/v1/delivery-requests**

###### **Do not forget to always pass real values in both “ContactEmail” and “ContactNumber”.**

Example Response :

###### **Status Code 200**

**Note**: In the above example, the “items” correspond to parcels, you **must not** pass every item in the order. Every register in the array “items” corresponds to a different parcel so if you have 2 registries you will get 2 parcel IDs as a response. While ***parcel ID** (parcels: id)* is BOX NOW internal unique ID used further to refer to the parcel.

5. Modify your delivery request */delivery-requests/{id}*

   After a delivery request is created, you can modify only the ***“allowReturn”***

   parameter of the request by calling the PUT method. Only this parameter is available to you:

| Name | Type | Description |
| ----- | ----- | ----- |
|  orderNumber |  string |  Unique order reference number you have used to create the delivery request. |

   See an example of a successful integration:

###### **PUT /api/v1/delivery-requests/{id}**

###### **Status Code 200**

6. Fetch a shipping label */parcels/{id}/label.{type}*

   Use this call to request a .pdf or .zpl file with a label you should print a stick onto each parcel.

   Available parameters:

| Name | Type | Description |
| ----- | ----- | ----- |
|  id\* |  string |  Unique parcel ID. You have received parcel ID after a successful delivery request creation or you can list all parcels, see …/parcels Example: 1234567890 Parcel ID is always a 10-digit number. |
|  type\* |  string |  *Available values*: pdf, zpl (zebra printer language) |
|  dpi |  number |  *Only applies to ZPL. Available values : 200, 300* Default value*: 200* |

\*Required values

See an example of a successful integration:

###### **GET /api/v1/parcels/{id}/label.pdf**

###### **Status Code 200**

.pdf file with the corresponding label

Alternatively, to *print all shipping labels* at once for your order, you can replace the

***/parcels/{id}*** part with ***/delivery-requests/{orderNumber}***: See an example of a successful integration:

###### **GET /api/v1/delivery-requests**

###### **Status Code 200**

.pdf file with all the corresponding shipping labels of the specific order

\*More information on Appendix 6.4.

###### **POST /api/v1/labels:search**

You can fetch multiple shipping labels on the same .pdf and declare the paperSize

###### **Status Code 200**

.pdf file with all the requested shipping labels

7. Cancel parcel delivery */api/v1/parcels/{id}:cancel*

###### **POST /api/v1/parcels/{id}:cancel**

You can cancel a parcel label after you create it. Canceling a canceled parcel has no effect.  
**IMPORTANT:** You can only cancel a parcel label when the status of a parcel is “New”. For other instances please refer to [**care@boxnow.gr**](mailto:care@boxnow.gr) .

8. #### (Optional)Address delivery-request

/api/v2/delivery-requests:checkAddressDelivery

###### **POST /api/v2/delivery-requests:checkAddressDelivery**

This Api call responds with the data of the closest locker to the given address. Most important is “id” which can be used immediately to create a delivery-request without the user choosing a particular locker(APM) from the map.

\**/v1/delivery-request:checkAddressDelivery* is deprecated and will **NOT** be functional in the future please use the above mentioned **v2.**

###### **Status Code 200**

\*More information on Appendix 6.3.5.

4. # Destination Map (Widget/Custom)

   1. Widget Integration

As an alternative to integrating our API, you can embed our out-of-the-box widget into your checkout page. This widget is communicating with our API and includes the same data you can access via **GET /api/v1/destination**.

You can find the widget via this link: [https://widget-v5.boxnow.gr/devs](https://widget-v5.boxnow.gr/devs) (Check example 1, example 2\)

*Note*: The widget map is communicating only with our Production environment. For the Stage (sandbox) environment, please contact us at [**ict@boxnow.gr**](mailto:ict@boxnow.gr) for further support.

*How to install BOX NOW Map Widget*

1. *Paste the BOX NOW Map Widget JavaScript code into the checkout page (or any other page where you want to display the BOX NOW Map Widget).*

2. *Create new HTML button with class attribute boxnow-widget-button to open BOX NOW Map Widget. For example:*

*\<a href="javascript:;" class="boxnow-widget-button"\>Open widget\</a\>*

3. *Create function for accept data from selected locker (id, address, name, etc.) BoxNow Map Widget (Javascript Code)*:

**Note**: The most important is variable \_bn\_map\_widget\_config. With this variable you can setup all required options, as shown below.

| Name | Usage | Description |
| ----- | ----- | ----- |
|  parentElement |  required |  Please fill CSS selector for Map Widget container. For example, just create \<div id="boxnowmap"\>\</div\> and fill \#boxnowmap. The BoxNow map widget will be placed inside this element. |

|  |  |  |
| ----- | ----- | ----- |
|  afterSelect |  required for type:iframe and type:popup |  Function that is triggered when the lock is selected. Included one parameter (object) contains all information about locker (properties boxnowLockerPostalCode, boxnowLockerAddressLine1 and boxnowLockerId are the most important). |
|  partnerId |  optional |  Please use your partnerId |
|  type |  optional |  Use iframe, popup or navigate. Default is iframe. |
|  gps |  optional |  Use it if you want to change the user's location request immediately after displaying the map. Possible options are true or false. Default is true. |
|  autoclose |  optional |  Use it when you want to change what happens after you select a locker. For type:iframe, the default value is true, which means that the map will be hidden when the locker is selected. For type:popup, autoclose is always true. The possible values are true or false. The default value is true. |

|  autoselect |  optional |  Selects a locker immediately after clicking on a locker on the map or in the list (not after clicking on the "select locker" button). Requires autoclose=false and type=iframe. The possible values are true or false. The default value is true. |
| ----- | ----- | :---- |
|  buttonSelector |  optional |  You can change the default class name to open the BoxNow Map Widget. Default is .boxnow-map-widget-button. |
|  zip |  optional |  If you have set gps=no, you can use this parameter to suggest a location on the map. The value can be a ZIP or part of a general address. |

Other useful JSON variables from the API, includes:

* **id** for locker ID

* **image** for a url with image of the locker

* **name** of the specific APM

* ###### **addressLine1** and **addressLine2**

* **postalCode**

* **note** for a detailed description of the locker’s location.

5. # Troubleshooting (Error Codes)

Description of all the error codes for *400 Unprocessable entity* responses:

###### **Error Code P400**

**Invalid request data**. Make sure you are sending the request according to the documentation.

###### **Error Code P401**

**Invalid request origin location reference**. Make sure you are referencing a valid location ID from Origins endpoint or valid address.

###### **Error Code P402**

**Invalid request destination location reference**. Make sure you are referencing a valid location ID from Destinations endpoint or valid address.

###### **Error Code P403**

**You are not allowed to use AnyAPM-SameAPM delivery**. Contact support if you believe this is a mistake.

###### **Error Code P404**

**Invalid import CSV**. See error contents for additional info.

###### **Error Code P405**

**Invalid phone number**. Make sure you are sending the phone number in full international format, e.g. \+30 xx x xxx xxxx.

###### **Error Code P406**

**Invalid compartment/parcel size**. Make sure you are sending one of required sizes 1, 2 or 3 (Small, Medium or Large). Size is required when sending from AnyAPM directly.

###### **Error Code P407**

**Invalid country code**. Make sure you are sending country code in ISO 3166-1 alpha-2 format, e.g. GR.

###### **Error Code P408**

**Invalid amountToBeCollected amount**. Make sure you are sending amount in the valid range of (0, 5000\)

###### **Error Code P409**

**Invalid delivery partner reference**. Make sure you are referencing a valid delivery partner ID from Delivery partners endpoint.

###### **Error Code P410**

**Order number conflict**. You are trying to create a delivery request for order ID that has already been created. Choose another order ID.

###### **Error Code P411**

**You are not eligible to use Cash-on-delivery payment type.** Use another payment type or contact our support.

###### **Error Code P412**

**You are not allowed to create customer returns deliveries**. Contact support if you believe this is a mistake.

###### **Error Code P413**

**Invalid return location reference**. Make sure you are referencing a valid location warehouse ID from Origins endpoint or valid address.

###### **Error Code P414**

**Unauthorized parcel access.** You are trying to access information to parcel/s that don't belong to you. Make sure you are requesting information for parcels you have access to.

###### **Error Code P415**

**You are not allowed to create delivery to home address**. Contact support if you believe this is a mistake.

###### **Error Code P416**

**You are not allowed to use COD payment for delivery to home address.** Contact support if you believe this is a mistake

###### **Error Code P417**

**You are not allowed to use q parameter.** It is forbidden for server partner accounts.

###### **Error Code P420**

**Parcel not ready for cancel.** You can cancel only new, undelivered, or parcels that are not returned or lost. Make sure parcel is in transit and try again.

###### **Error Code P421**

**Invalid parcel weight**. Make sure you are sending value between 0 and 10^6.

###### **Error Code P422**

**Address not found**. Try to call just with postal code and country.

**Error Code P423**

**Nearby locker not found.**

**Error Code P424**

**Invalid region format**. Please ensure the format includes a language code followed by a country	code in ISO 3166-1 alpha-2 format, separated by a hyphen, e.g. el-GR, or region exists in context.

###### **Error Code P430**

**Parcel not ready for AnyAPM confirmation.** Parcel is probably already confirmed or being delivered. Contact support if you believe this is a mistake.

###### **Error Code P440**

**Ambiguous partner.** Your account is linked to multiple partners and is unclear on whose behalf you want to perform this action. Send **X-PartnerID** header with ID of the partner you want to manage. You can get list of available Partner IDs from /entrusted-partners endpoint.

###### **Error Code P441**

**Invalid X-PartnerID header.** Value you provided for X-PartnerID header is either invalid or references partner you don't have access to. Make sure you are sending ID from  
/entrusted-partners endpoint.

###### **Error Code P442**

Invalid limit query parameter. The query limit for this API has been exceeded. Please reduce the size of your query (max allowed is 100).

If you are having troubles integrating our API into your online store based on the current documentation, reach out to us at [**ict@boxnow.gr**](mailto:ict@boxnow.gr).

6. # Appendix (API Endpoints)

Below you can find all the API endpoints/calls with regards to the complete structure of the BoxNow Partner API:

1. ## **Authentication**

| TYPE | Endpoint | Description |
| :---: | :---: | :---: |
| POST | …/api/v1/auth-sessions | Obtain authentication tokens |

Parameters:

##### **N/A**

Request body (example):

Responses:

|  Code |  |  Description |  Example Value |  |
| ----- | ----- | ----- | ----- | ----- |
| 200 |  | OK | Below ![][image3] |  |
| { "access\_token": "eyJz93a...k4laUWw", "token\_type": "Bearer", "expires\_in": 3600 } |  |  |  |  |
|  **Code** |  **Description** |  |  |  **Example Value** |
|  400 | The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  |  |  N/A |
| 401 |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. |  |  |  N/A |
| 403 | Account disabled. Your account had been disabled, contact support. |  |  |  N/A |

2. ## **Locations**

   1. ##### **ORIGINS**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | :---- |

|  GET | Stage: [*https://locationapi-stage.boxnow.gr/api/v1/origins*](https://locationapi-stage.boxnow.gr/api/v1/origins) Production: [*https://locationapi-*](https://locationapi/) *production.boxnow.gr/api/v1/origins* |  List available origins to pickup the order from |
| ----- | :---- | :---- |

Parameters:

|  Name |  Type |  Description |  Example |
| ----- | ----- | ----- | ----- |
| latlng | *string* |  If applied only locations in the specified radius from this gps coord are returned |  48.78081955454138, 12.446962472273063 |
| radius | *number* |  Radius in meters to return only locations within selected radius from given GPS location. Ignored if latlng is not present. | 1000 *Default Value*: 25000 |
| requiredSize | *number* | Return only locations that can accept a package of your requiredSize |  1 *Available values*: *0,* 1, 2, 3 |
| locationType | *array* |  Return only locations with given types. If not present, filter is not applied. |  *Available values* : any-apm, warehouse |
|  name |  *string* |  Return only locations with matching name |  N/A |

Note: In case of Any APM please disregard the value 0 in requiredSize, as it is necessary to set a value in that case.

Request body (example):

##### **N/A**

Responses:

|  Code |  Description |  Example Value |
| ----- | ----- | ----- |
| 200 | OK | Below ![][image3] |

| { |  |  |  |
| ----- | :---- | ----- | ----- |
|  | "data": \[ |  |  |
|  | { |  |  |
|  | "id": "string", |  |  |
|  | "type": "apm", |  |  |
|  | "image": "[https://via.placeholder.com/150](https://via.placeholder.com/150)", |  |  |
|  | "lat": "48.78081955454138", |  |  |
|  | "lng": "12.446962472273063", |  |  |
|  | "title": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", |  |  |
|  | "name": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", |  |  |
|  | "addressLine1": "ΛΕΩΦΟΡΟΣ ΕΙΡΗΝΗΣ 28", |  |  |
|  | "addressLine2": "string", |  |  |
|  | "postalCode": "15121", |  |  |
|  | "country": "GR", |  |  |
|  | "note": "You can find it behind the pet shop" |  |  |
|  | } |  |  |
|  | \] |  |  |
| } |  |  |  |
|  **Code** |  |  **Description** |  **Example Value** |
|  400 |  | The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  N/A |
| 401 |  |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. |  N/A |
| 403 |  | Account disabled. Your account had been disabled, contact support. |  N/A |

2. ##### **DESTINATIONS**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | :---- |
| GET | **Stage**: [*https://locationapi-stage.boxnow.gr/api/v1/origins*](https://locationapi-stage.boxnow.gr/api/v1/origins) **Production**: [*https://locationapi-*](https://locationapi/) *production.boxnow.gr/api/v1/origins* |  List available destinations to deliver the order to |

Parameters:

|  Name |  Type |  Description |  Example |
| ----- | ----- | ----- | ----- |
| latlng | *string* |  If applied only locations in the specified radius from this gps coord are returned |  48.78081955454138, 12.446962472273063 |
| radius | *number* |  Radius in meters to return only locations within selected radius from given GPS location. Ignored if latlng is not present. | 1000 *Default Value*: 25000 |
| requiredSize | *number* | Return only locations that can accept a package of your requiredSize |  1 *Available values*: 1, 2, 3 |
| locationType | *array* |  Return only locations with given types. If not present, filter is not applied. |  *Available values* : any-apm, apm |
|  name |  *string* |  Return only locations with matching name |  N/A |

Request body (example):

##### **N/A**

Responses:

|  Code |  Description |  Example Value |
| ----- | ----- | ----- |
| 200 | OK | Below ![][image3] |

| { "data": \[ { "id": "string", "type": "apm", "image": "[https://via.placeholder.com/150](https://via.placeholder.com/150)", "lat": "48.78081955454138", "lng": "12.446962472273063", "title": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", "name": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", "addressLine1": "ΛΕΩΦΟΡΟΣ ΕΙΡΗΝΗΣ 28", "addressLine2": "string", "postalCode": "15121", "country": "GR", "note": "You can find it behind the pet shop", "expectedDeliveryTime": "2021-06-07T12:33:18.723Z" } \] } |  |  |
| ----- | ----- | ----- |
|  **Code** |  **Description** |  **Example Value** |
|  400 | The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  N/A |
| 401 |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. |  N/A |
| 403 | Account disabled. Your account had been disabled, contact support. |  N/A |

3. ## **Delivery Requests**

   1. ###### **Complex Delivery Request**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | :---- |

| POST | …/api/v1/delivery-requests |  Create a delivery request for your order |
| :---: | :---- | :---- |

Parameters:

##### **N/A**

Request body (example):

{

"typeOfService": "same-day", "description": "string", "orderNumber": "string", "invoiceValue": "25.50", "paymentMode": "prepaid", "amountToBeCollected": "25.50", "allowReturn": true,  
"notifyOnAccepted": "[partner@example.com](mailto:partner@example.com)",

"notifySMSOnAccepted": "+30 21 4 655 1234", "origin": {

"contactNumber": "+30 21 4 655 1234", "contactEmail": "string", "contactName": "Yiannis Papadopoulos", "deliveryPartnerId": "7983",

"title": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", "name": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", "addressLine1": "ΛΕΩΦΟΡΟΣ ΕΙΡΗΝΗΣ 28",  
"addressLine2": "string", "postalCode": "15121", "country": "GR",  
"note": "You can find it behind the pet shop", "locationId": "string"  
},

"destination": {

"contactNumber": "+30 21 4 655 1234", "contactEmail": "string", "contactName": "Yiannis Papadopoulos", "deliveryPartnerId": "7983",

"title": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", "name": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", "addressLine1": "ΛΕΩΦΟΡΟΣ ΕΙΡΗΝΗΣ 28",  
"addressLine2": "string", "postalCode": "15121", "country": "GR",  
"note": "You can find it behind the pet shop", "locationId": "string"  
},

"items": \[

{

"id": "string", "name": "Smartphone",

Responses:

|  |  Code	Description |  |  |  |  Example Value |
| ----- | :---- | ----- | :---: | ----- | ----- |
| 200 |  |  | OK | Below ![][image3] |  |
| {  } |  "id": "string", "parcels": \[ { "id": "string" } \] |  |  |  |  |
|  **Code** |  |  **Description** |  |  |  **Example Value** |
|  400 |  | Bad Request. The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  |  |  N/A |
| 401 |  |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. |  |  |  N/A |
| 403 |  | Account disabled. Your account had been disabled, contact support. |  |  |  N/A |

2. ###### **Simple Delivery Request**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | :---- |
| POST | …/api/v1/simple-delivery-requests |  Create delivery request order with minimum amount of data |

Parameters:

##### **N/A**

Request body (example):

Responses:

|  Code |  Description |  Example Value |
| ----- | ----- | ----- |
| 200 | OK | Below ![][image3] |

| { "id": "string", "orderNumber": "12309284", "labels": \[ { "type": "pdf", "mimetype": "application/pdf", "url": "[https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)" } \], "parcels": \[ { "id": "string", "labels": \[ { "type": "pdf", "mimetype": "application/pdf", "url": "[https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)" } \] } \] } |  |  |
| ----- | ----- | ----- |
|  **Code** |  **Description** |  **Example Value** |
|  400 |  Bad Request. The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  N/A |
|  |  |  |
| 401 |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. |  N/A |
| 403 | Account disabled. Your account had been disabled, contact support. |  N/A |

| 503 | Service Unavailable | N/A |
| :---: | :---- | :---: |

3. ###### **CSV Delivery Request**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | ----- |
| POST | …/api/v1/delivery-requests:fromCsv | Create a delivery request from CSV |

Parameters:

##### **N/A**

Request body (example):

- **type \* Required** string

- ###### **file \* Required**

  string($binary)

CSV Example (Delivery from a warehouse): from\_location,destination\_location,customer\_phone\_number,customer\_email,custom er  
\_full\_name,number\_of\_parcels(default 1),payment\_mode(cod, prepaid \-

default),amount\_to\_be\_collected(default 0.00),price\_currency(default EUR) 1,2,+30 21 4 655 1234,someone@example.com,Yiannis Papadopoulos,3,cod,24.00,EUR

CSV Example (Delivery from AnyAPM):

destination\_location,parcel\_size,customer\_phone\_number,customer\_email,customer

\_f ull\_name,number\_of\_parcels(default 1),payment\_mode(cod, prepaid \- default),amount\_to\_be\_collected(default 0.00),price\_currency(default EUR) 2,1,+30 21 4 655 1234,someone@example.com,Yiannis Papadopoulos,3,cod,24.00,EUR

Responses:

|  Code |  |  Description |  |  Example Value |
| ----- | ----- | ----- | ----- | ----- |
| 200 |  | OK | Below ![][image3] |  |
| \[ { "id": "string", "destination": { "contactName": "Yiannis Papadopoulos" }, "parcels": \[ { "id": "string", "labelUrl": "[https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)" } \] } \] |  |  |  |  |
|  **Code** |  **Description** |  |  |  **Example Value** |
|  400 | Bad Request. The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  |  |  N/A |
| 403 |  Account disabled. Your account had been disabled, contact support. |  |  | N/A |

4. ###### **Return Delivery Request**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | :---- |
| POST | …/api/v1/delivery-requests:customerReturns |  Create a request delivery of parcel that customer would like to return |

Parameters:

##### **N/A**

Request body (example):

Responses:

|  Code |  Description |  Example Value |
| ----- | ----- | ----- |
| 200 | OK | Below ![][image3] |

| { "id": "string", "orderNumber": "12309284", "labels": \[ { "type": "pdf", "mimetype": "application/pdf", "url": "[https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)" } \], "parcels": \[ { "id": "string", "labels": \[ { "type": "pdf", "mimetype": "application/pdf", "url": "[https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)" } \] } \] } |  |  |
| ----- | ----- | ----- |
|  **Code** |  **Description** |  **Example Value** |
|  400 | Bad Request. The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  N/A |
| 401 |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. |  N/A |
| 403 |  Account disabled. Your account had been disabled, contact support. | N/A |

5. ###### **Address Delivery Request**

|  TYPE |  Endpoint |  Description |
| :---- | ----- | :---- |

| POST |  …/api/v2/deliveryrequests:checkAddressDelivery |  Check if address for delivery is available |
| :---- | :---- | :---- |

\**/v1/delivery-request:checkAddressDelivery* is deprecated and will NOT be functional in the future please use the above mentioned **v2**

Parameters:

##### **N/A**

Request body (example):

Responses:

|  Code |  Description |  |  Example Value |
| ----- | ----- | ----- | :---- |
| 200 | OK | Below ![][image3] |  |
|  |  |  |  |
| { "id": "9", "type": "apm", "image": "", "lat": "37.98667955374032", "lng": "23.697897257052723", "title": "IEPA OΔOΣ 116, 10447", "name": "Aegean ΜΕΤΡΟ Ελαιώνας", "postalCode": "10447", "country": "GR", "note": "Βρίσκεται σε μια πλευρά του βενζινάδικου \\"Aegean\\", ορατό από την απέναντι πλευρά του δρόμου.", "addressLine1": "Iερά Οδός 116", "addressLine2": "Αθήνα", "region": "el-GR", "distance": 858.08297333 } |  |  |  |
|  |  |  |  |

|  Code |  Description |  Example Value |
| ----- | ----- | ----- |
|  400 |  Bad Request. The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request |  N/A |
|  | message). You are to modify the request before sending it again. |  |
| 402 | Location error. No location can be found for the request |  N/A |
| 503 | Service Unavailable | N/A |

6. ###### **Update Delivery Request**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | ----- |
| PUT | …/api/v1/delivery-requests:{orderNumber} |  Update a created delivery request. |

Parameters:

|  Name |  Type |  Description |  Example |
| ----- | ----- | ----- | ----- |
| orderNumber\* | *string* |  Unique order number in Your system. The same you use to create the delivery request. | N/A |

\****Required value***

You can only update the “allowReturn” variable. Request body (example):

}	

Responses:

|  Code |  |  Description |  |  Example Value |
| ----- | ----- | ----- | ----- | ----- |
| 200 |  | OK | Below ![][image3] |  |
| { "id": "string" } |  |  |  |  |
|  **Code** |  **Description** |  |  |  **Example Value** |
|  400 |  Bad Request. The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  |  |  N/A |
|  |  |  |  |  |
| 402 |  Location error. No location can be found for the request |  |  |  N/A |
| 404 |  Resource not found. You are authorized but the requested resource does not exist. Make sure the requested URL is correct. |  |  | N/A |

4. ## **Labels**

   1. ###### **Single Shipping Label**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | :---- |

| GET | … /api/v1/parcels/{id}/label.{type} |  Get printable label for parcel. |
| :---: | :---- | :---- |

Parameters:

|  Name |  Type |  Description |  Example |
| ----- | ----- | ----- | ----- |
| Id\* | *string* |  Unique parcel ID. You have received parcel ID after a successful delivery request creation or you can list all parcels, see /parcels |  Unique 10-digit parcel ID. Example: 1234567890 |
| type\* | *string* |  The output format of the file you want your shipping label |  *Available values*: .pdf, .zpl |
| dpi | *number* | Only applies to .zpl (Zebra Printing Language). 200 or 300 supported. |  *Available values*: 200, 300 *Default value*: 200 |

\****Required value***

Request body (example):

##### **N/A**

Responses:

|  Code |  |  Description |  Example Value |  |
| ----- | ----- | ----- | :---- | ----- |
| 200 |  | OK | String (below) ![][image3] |  |
| string |  |  |  |  |
|  **Code** |  **Description** |  |  |  **Example Value** |
| 401 |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. |  |  |  N/A |

| 403 | Account disabled. Your account had been disabled, contact support. |  N/A |
| :---: | ----- | ----- |
| 404 |  Resource not found. You are authorized but the requested resource does not exist. Make sure the requested URL is correct. | N/A |

2. ###### **Multiple Shipping Labels**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | ----- |
| GET |  … /api/v1/deliveryrequests/{orderNumber}/label.{type} |  Get shipping labels for all parcels in a delivery request. |

Parameters:

|  Name |  Type |  Description |  Example |
| ----- | ----- | ----- | ----- |
| orderNumber\* | *string* |  Unique order number in Your system. The same you use to create the delivery request. | N/A |
| type\* | *string* |  The output format of the file you want your shipping label |  *Available values*: .pdf, .zpl |
| dpi | *number* | Only applies to .zpl (Zebra Printing Language). 200 or 300 supported. |  *Available values*: 200, 300 *Default value*: 200 |

\****Required value***

Request body (example):

##### **N/A**

Responses:

|  Code |  |  Description |  Example Value |  |
| ----- | ----- | ----- | :---- | ----- |
| 200 |  | OK | String (below) ![][image3] |  |
| string |  |  |  |  |
|  **Code** |  **Description** |  |  |  **Example Value** |
| 401 |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. |  |  |  N/A |
| 403 | Account disabled. Your account had been disabled, contact support. |  |  |  N/A |
| 404 |  Resource not found. You are authorized but the requested resource does not exist. Make sure the requested URL is correct. |  |  | N/A |

5. ## **Parcels**

   1. ###### **Confirm AnyAPM Parcel Delivery**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | :---- |
| POST | …/api/v1/parcels/{id}:confirm-anyapm-delivery |  Confirm parcel has been delivered to AnyAPM |

   Parameters:

|  Name |  Type |  Description |  Example |
| :---- | :---- | ----- | :---- |

| id\* | *string* |  Unique parcel ID. You have received parcel ID after a successful delivery request creation or you can list all parcels, see /parcels |  Unique 10-digit parcel ID. Example: 1234567890 |
| :---: | :---- | ----- | ----- |

***\* Required value***

Request body (example):

##### **N/A**

Responses:

|  Code |  Description |  Example Value |
| ----- | ----- | ----- |
|  200 |  OK |  N/A |
|  400 |  Bad Request. The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  N/A |
| 401 |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. | N/A |
| 403 |  Account disabled. Your account had been disabled, contact support. | N/A |
| 404 |  Resource not found. You are authorized but the requested resource does not exist. Make sure the requested URL is correct. |  N/A |

|  503 |  Service Unavailable |  N/A |
| ----- | :---- | ----- |

2. ###### **Cancel Parcel**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | ----- |
| POST | …/api/v1/parcels/{id}:cancel |  Cancel parcel delivery |

*Note*: Cancelling a cancelled parcel has no effect.

Parameters:

|  Name |  Type |  Description |  Example |
| ----- | ----- | ----- | ----- |
| id\* | *string* |  Unique parcel ID. You have received parcel ID after a successful delivery request creation or you can list all parcels, see /parcels |  Unique 10-digit parcel ID. Example: 1234567890 |

***\* Required value***

Request body (example):

##### **N/A**

Responses:

|  Code |  Description |  Example Value |
| ----- | ----- | ----- |
|  200 |  OK |  N/A |
| 401 |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. | N/A |

| 403 |  Account disabled. Your account had been disabled, contact support. | N/A |
| :---: | ----- | ----- |
| 404 |  Resource not found. You are authorized but the requested resource does not exist. Make sure the requested URL is correct. |  N/A |

3. ###### **Parcel Information**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | :---- |
| GET | … /api/v1/parcels |  List all parcel info related to your delivery requests |

Parameters:

|  Name |  Type |  Description |  Example |
| ----- | ----- | ----- | ----- |
| q | *string* |  Search in: Order ID, Parcel ID, Customer name, Customer email, Customer phone number |  N/A |
| limit | *number* | Page size |  24 *Default Value*: 50 |
| orderNumber | *string* |  Order number in your system. Return only parcels related to this order number. | N/A |
| parcelId | *string* |  ID of the parcel in our system. Return only parcel/s with this ID. | N/A |

| paymentState | *string* | The payment state of a parcel. |  *Available values*: pending, paid-by-customer, transferred-to-partner |
| :---: | ----- | ----- | ----- |
| paymentMode | *string* |  The payment method selected for the parcel |  *Available values*: prepaid, cod *Default value*: prepaid |
| state | *array \[string\]* | The state of the parcel during the whole process. |  *Available values:* new, intransit, expired-return, returned, in-final-destination, delivered, wait-for-load, lost, cancelled, missing |
| pageToken | *string* |  Set this token to return records for given page. You get this for each response. |  N/A |

Request body (example):

##### **N/A**

Responses:

|  Code |  Description |  Example Value |
| ----- | ----- | ----- |
| 200 | OK | Below ![][image3] |

{  
"pagination": { "first": "string",  
"last": "string",  
"next": "string",

"prev": "string"  
},  
"count": 0,

"data": \[  
{

"id": "string",  
"state": "new", "name": "Smartphone", "value": "4.56",  
"weight": "1.6",

"compartmentSize": 0, "originDeliveryRefId": "string", "destinationDeliveryRefId": "string", "itemRefId": "string",  
"allowReturn": true, "deliveryRequest": {  
"typeOfService": "same-day", "description": "string", "orderNumber": "string", "invoiceValue": "25.50", "paymentMode": "prepaid", "amountToBeCollected": "25.50", "allowReturn": true,

"notifyOnAccepted": "[partner@example.com](mailto:partner@example.com)", "notifySMSOnAccepted": "+30 21 4 655 1234", "origin": {  
"contactNumber": "+30 21 4 655 1234", "contactEmail": "string", "contactName": "Yiannis Papadopoulos", "deliveryPartnerId": "7983",

"title": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", "name": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", "addressLine1": "ΛΕΩΦΟΡΟΣ ΕΙΡΗΝΗΣ 28",  
"addressLine2": "string", "postalCode": "15121", "country": "GR",  
"note": "You can find it behind the pet shop", "locationId": "string"  
},  
"destination": {

"contactNumber": "+30 21 4 655 1234", "contactEmail": "string", "contactName": "Yiannis Papadopoulos", "deliveryPartnerId": "7983",  
"title": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ",

| "name": "ΠΑΝΤΕΛΟΓΛΟΥ ΔΗΜΗΤΡΗΣ", "addressLine1": "ΛΕΩΦΟΡΟΣ ΕΙΡΗΝΗΣ 28", "addressLine2": "string", "postalCode": "15121", "country": "GR", "note": "You can find it behind the pet shop", "locationId": "string" }, "items": \[ { "id": "string", "name": "Smartphone", "value": "3.45", "weight": 0, "compartmentSize": 0, "originDeliveryParcelId": "415-02914-308", "destinationDeliveryParcelId": "415-02914-308" } \] }, "events": \[ { "type": "new", "locationDisplayName": "Ελληνικά Ταχυδρομεία", "postalCode": "104 37", "createTime": "2021-06-07T12:33:18.723Z" } \], "parcelLabelUrl": "[https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)", "orderLabelUrl": "[https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)", "cancelationRequested": true, "payment": { "mode": "prepaid", "price": { "amount": "string", "currency": "string" }, "state": "pending" }, "createTime": "2021-06-07T12:33:18.723Z", "updateTime": "2021-06-07T12:33:18.723Z"	} \] } |  |  |
| :---- | ----- | :---- |
|  **Code** |  **Description** |  **Example Value** |

|  400 |  Bad Request. The server cannot or will not process the request due to something that is perceived to be your error (e.g., malformed request syntax, invalid request message). You are to modify the request before sending it again. |  N/A |
| ----- | ----- | ----- |
| 401 |  Not Authorized. You are either using an expired Access token to access the data or trying to initialize Auth session with invalid data. |  N/A |
| 403 |  Account disabled. Your account had been disabled, contact support. | N/A |

\*Note: The aforementioned “state“ parameter refers to the status of a parcel in a given timeframe. Following are the definitions of each parcel type event (state):

* new \- Parcel has been registered in the system

* delivered \- Parcel has been delivered

* expired-return \- Parcel expired and will be returned to the sender

* returned \- Parcel has been returned to the sender

* in-transit \- Parcel is being transferred to a specific location.

* in-depot \- Parcel is in one of our warehouses

* in-final-destination \- Parcel has reached its final destination, waiting for pickup

* cancelled \- Parcel order had been canceled by the sender

* wait-for-load \- Parcel is waiting in a specific APM to be taken over by BOX NOW courier for either to be returned to the sender or transferred to another APM.

* accepted-for-return \- Parcel has been accepted from customer and will be returned to the sender

* missing \- BoxNow pickup courier was unable to obtain the parcel for delivery

  6. ### **Delivery Partners**

|  TYPE |  Endpoint |  Description |
| ----- | ----- | ----- |
| GET | … /api/v1/ delivery-partners |  List of available delivery partners |

Parameters:

##### **N/A**

Request body (example):

##### **N/A**

Responses:

|  Code |  |  Description |  Example Value |  |
| ----- | ----- | ----- | ----- | ----- |
| 200 |  | OK | Below ![][image3] |  |
| { "data": \[ { "id": "string", "name": "Delivery-Partner" } \] } |  |  |  |  |
|  **Code** |  **Description** |  |  |  **Example Value** |
| 403 |  Account disabled. Your account had been disabled, contact support. |  |  | N/A |

[image1]: <data:image/png;base64,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>

[image2]: <data:image/png;base64,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>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAVCAYAAACpF6WWAAAAPklEQVR4Xu3LsQkAMAwDQe2/tIMXuECaNDpQJT6pmsueKNRHCvWRQn2kUB8p1EcK9ZFCfaRQHynURxtq9dkBl2Qh347oLD4AAAAASUVORK5CYII=>