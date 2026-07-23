# ACS Rest API

Περιεχόμενα

[ΠΡΟΔΙΑΓΡΑΦΕΣ 1](#_TOC_250021)

[ΒΗΜΑ 1 – ΕΓΚΑΤΑΣΤΑΣΗ INSOMNIA (για δοκιμές) 3](#_TOC_250020)

[ΒΗΜΑ 2 – ΕΝΑΡΞΗ INSOMNIA 3](#_TOC_250019)

[SWAGGER UI 4](#_TOC_250018)

[ΔΗΜΙΟΥΡΓΙΑ VOUCHER 4](#_TOC_250017)

[ΠΟΛΛΑΠΛΑ VOUCHERS (πολλαπλή αποστολή) 8](#_TOC_250016)

[ΕΚΤΥΠΩΣΗ VOUCHER 9](#_TOC_250015)

[ΔΙΑΓΡΑΦΗ VOUCHER 11](#_TOC_250014)

[ΠΕΡΙΕΧΟΜΕΝΟ ΑΠΟΣΤΟΛΩΝ ΚΥΠΡΟΥ 11](#_TOC_250013)

[ΛΙΣΤΑ ΠΑΡΑΛΑΒΗΣ (οριστικοποίηση vouchers) 12](#_TOC_250012)

[ΕΚΤΥΠΩΣΗ ΛΙΣΤΑΣ ΠΑΡΑΛΑΒΗΣ 14](#_TOC_250011)

[ΕΜΦΑΝΙΣΗ ΛΙΣΤΩΝ ΠΑΡΑΛΑΒΗΣ ΗΜΕΡΑΣ 14](#_TOC_250010)

[ΕΜΦΑΝΙΣΗ ΑΠΟΣΤΟΛΩΝ ΛΙΣΤΑΣ ΠΑΡΑΛΑΒΗΣ 15](#_TOC_250009)

[ΑΝΑΛΥΣΗ ΑΠΟΔΟΣΗΣ ΑΝΤΙΚΑΤΑΒΟΛΩΝ 16](#_TOC_250008)

[TRACKING ΠΕΡΙΛΗΠΤΙΚΟ (Summary) 17](#_TOC_250007)

[TRACKING ΑΝΑΛΥΤΙΚΟ (Details) 19](#_TOC_250006)

[ΑΝΑΖΗΤΗΣΗ VOUCHER ΒΑΣΕΙ ΚΛΕΙΔΙΟΥ ΑΝΑΦΟΡΑΣ 20](#_TOC_250005)

[ΥΠΟΛΟΓΙΣΜΟΣ ΚΟΣΤΟΥΣ 20](#_TOC_250004)

[ΕΛΕΓΧΟΣ ΔΙΕΥΘΥΝΣΗΣ ΠΡΟΟΡΙΣΜΟΥ 22](#_TOC_250003)

[ΑΝΑΖΗΤΗΣΗ ΒΑΣΕΙ ΤΚ 23](#_TOC_250002)

[ΣΤΟΙΧΕΙΑ ΚΑΤΑΣΤΗΜΑΤΩΝ ACS 25](#_TOC_250001)

[GENERATE CLIENT CODE 26](#_TOC_250000)

# ΠΡΟΔΙΑΓΡΑΦΕΣ

Τα ACS Web Services είναι **REST API** και εδώ περιγράφεται η γενική μεθοδολογία κλήσης, παραμέτρων και απαντήσεων.

Ο server δέχεται πάντα **POST** request και απαντά response σε μορφή **JSON**. Για οποιαδήποτε κλήση πρέπει να υπάρχει API KEY που δίνεται από την ACS.

Ο server πάντα επιστρέφει **200 ΟΚ** με εξαίρεση αν είναι λάθος το API Key ή δεν αποστέλλεται καθόλου από τον client οπού και επιστρέφει **403 Forbidden** και **406 Not Acceptable σε περίπτωση που ο client υπερβεί το προκαθορισμένο επιτρεπτό μέγιστο αριθμό ταυτόχρονων κλήσεων σε κάθε δευτερόλεπτο (default 10 κλήσεις/sec).**

Σε όλα τα request υπάρχει μια παράμετρος που ονομάζεται **ACSAlias** και άφορα την διαδικασία στην οποία θα γίνει η κλήση. Είναι η ελάχιστη απαιτούμενη παράμετρος και η μορφή του JSON σε POST είναι

{ ACSAlias: '&lt;MyInterfaceToCallName&gt;' } Για να είναι η κλήση επιτυχής πρέπει:

1.  Ο πελάτης να έχει το API KEY της ACS.
2.  Ο πελάτης να περάσει αυτό το API KEY στο header του HTTPS request με όνομα **ACSApiKey**.
3.  To συγκεκριμένο API KEY να έχει δικαιώματα κλήσης πάνω στην διαδικασία που γίνεται η κλήση δηλαδή στο ACSAlias.
4.  Αν υπάρχει κλείδωμα με IP η IP που γίνεται η κλήση να είναι white list.
5.  Στο request να έχουν οριστεί σωστά τα ορίσματα - παράμετροι που απαιτεί η κάθε κλήση.

Το root URL όλων των κλήσεων παραμένει ίδιο και είναι https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest

Υπάρχουν οι παρακάτω controllers στο παραπάνω URL Α) **ACSAutoRestHelp**

1.  GET δέχεται σαν όρισμα το ACSAlias ('&lt;MyInterfaceToCallName&gt;') και επιστρέφει μια περιγραφή για την διαδικασία σε text.
2.  POST δέχεται σαν όρισμα το ACSAlias ({ACSAlias: '&lt;MyInterfaceToCallName&gt;'}) και επιστρέφει το JSON που απαιτεί η συγκεκριμένη διαδικασία σαν όρισμα να εκτελεστεί.

Β) **ACSAutoRest**

POST δέχεται σαν όρισμα το ACSAlias και τις απαιτούμενες παραμέτρους σε JSON όπως μας επιστρέφει παραπάνω η Α2 και επιστρέφει σε JSON τα αποτελέσματα της εκτέλεσης της συγκεκριμένης διαδικασίας σύμφωνα με τις παραμέτρους που εισάγαμε.

Το JSON που δέχεται είναι της μορφής

{

"ACSAlias": "&lt;MyInterfaceToCallName&gt;", "ACSInputParameters":{

"InParam-1": Param_1_Value, "InParam-2": Param_2_Value, "InParam-n": Param_n_Value}

}

Όπου **ACSAlias** το όνομα της μεθόδου που θα γίνει κλήση, όπου **ACSInputParameters** ο τομέας οπού ονομαστικά δίνονται τιμές στις παραμέτρους που δέχεται η συγκεκριμένη κλήση προκειμένου να εκτελεστεί.

Όλες οι απαντήσεις response της εκτέλεσης μιας διαδικασίας είναι της μορφής

{

"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponse": {

&lt;ACS OUTPOUT RESPONSE DATA&gt;

}

}

Όπου:

**ACSExecution_HasError** → **false** επιτυχής εκτέλεση, **true** ανεπιτυχής εκτέλεση. **ACSExecutionErrorMessage →** έχει την περιγραφή του προβλήματός της εκτέλεσης και έχει τιμή διάφορη του κενού μόνο αν ACSExecution_HasError είναι true (περιγράφονται αναλυτικά οι τιμές παρακάτω στον section errors).

**ACSOutputResponse** έχει τα αποτελέσματα της εκτέλεσης και έχει τιμή-τιμές μόνο όταν **ACSExecution_HasError → false.**

Το **ACSOutputResponce** μπορεί να περιέχει απλά ορίσματα με τιμές ή και ολόκληρα records που επαναλαμβάνονται σε λίστες.

Αν υπάρχει όρισμα επιστροφής με ονομασία **Return_Data** μπορεί να γίνει deserialize σε **.NET DataSet.**

## ΒΗΜΑ 1 – ΕΓΚΑΤΑΣΤΑΣΗ INSOMNIA (για δοκιμές)

Για **δοκιμές και μόνο** στα νέα ACS Web Services προτείνεται να χρησιμοποιηθεί το **Insomnia Rest Client** που μπορείτε να το κατεβάσετε από το [**https://insomnia.rest**](https://insomnia.rest/)**.** Στην αρχική οθόνη επιλέγετε download for windows (επάνω δεξιά στην επιλογή docs υπάρχουν οδηγίες για την εγκατάσταση της εφαρμογής σε διάφορα λειτουργικά).

# ΒΗΜΑ 2 – ΕΝΑΡΞΗ INSOMNIA

Για να δημιουργήσουμε το πρώτο αίτημά, κάνουμε κλικ στο εικονίδιο **\+** στο επάνω μέρος της πλαϊνής γραμμής και επιλέγουμε **New Request**.

Στη συνέχεια, και αναλόγως του εργαλείου με το οποίο θα ασχοληθούμε, θα μας ζητηθεί να δώσουμε ένα όνομα. Στο παράδειγμα μας δίνουμε το όνομα **ACS_Create_Voucher**.

Κατόπιν επιλέγουμε την επιθυμητή μέθοδο HTTPS (για τα εργαλεία της ACS επιλέγουμε **πάντα GET)**. Στο τέλος εκτελούμε **Create.**

Αφού έχει δημιουργηθεί το request έχουμε την οθόνη:

Επιλέγουμε την μέθοδο **POST,** ως body **JSON** και ορίζουμε τη διεύθυνση URL https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest

Στο tab **HEADER** βλέπουμε ότι υπάρχει ήδη συμπληρωμένο το content type. Στο new header καταχωρούμε το λεκτικό **AcsApiKey** και στο πεδίο value το κλειδί που μας δίνει η ACS. Δεν ασχολούμαστε με τα υπόλοιπα tabs (Auth, Query, Docs).

# SWAGGER UI

Έχει υλοποιηθεί swagger UI για τα rest web services της εταιρείας μας.

Το url είναι το γνωστό των webservices ακολουθούμενο με /swagger/ δηλ. https://webservices.acscourier.net/ACSRestServices/swagger/

Για να εκτελεστεί κάποια μέθοδο με το κουμπί “Try It Out” θα πρέπει να έχει συμπληρωθεί το απαιτούμενο με τα δικαιώματα ApiKey πάνω δεξιά

# ΔΗΜΙΟΥΡΓΙΑ VOUCHER

Η μέθοδος δημιουργεί το αποδεικτικό ή τα αποδεικτικά (vouchers) της ACS για αποστολές εντός Ελλάδας ή προς Κύπρο (Xpress ή με το προϊόν EC - ACS CYPRUS ECONOMY). **Δεν υποστηρίζει δημιουργία voucher προς λοιπές χώρες.**

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_Create_Voucher"

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα demo request – response **:**

|     |     |
| --- | --- |
| **Request** | **Response** (με κίτρινο χρώμα ο κωδικός της αποστολής) |
| {<br><br>"ACSAlias": "ACS_Create_Voucher", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "Pickup_Date": '2019-01-10', "Sender": 'ESHOP',<br><br>"Recipient_Name": 'TEST RECIPIENT', "Recipient_Address": 'P. RALLI', "Recipient_Address_Number": 45,<br><br>"Recipient_Zipcode": 17778, "Recipient_Region": 'TAVROS', "Recipient_Phone": 2115005000,<br><br>"Recipient_Cell_Phone": 699999999, "Recipient_Floor": null, "Recipient_Company_Name": null, "Recipient_Country": 'GR', "Acs_Station_Destination": null, "Acs_Station_Branch_Destination": 1, "Billing_Code": '2ΑΘ999999', "Charge_Type": 2, "Cost_Center_Code": null, "Item_Quantity": 1,<br><br>"Weight": 0.5, "Dimension_X_In_Cm": null, "Dimension_Y_in_Cm": null, "Dimension_Z_in_Cm": null, "Cod_Ammount": 50.5,<br><br>"Cod_Payment_Way": 0, "Acs_Delivery_Products": 'COD', "Insurance_Ammount": null, "Delivery_Notes": null, "Appointment_Until_Time": null, "Recipient_Email": null, "Reference_Key1": null, "Reference_Key2": null, "With_Return_Voucher": null, "Content_Type_ID": null, "Language": null<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"Voucher_No": " 7227889174", "Voucher_No_Return": null, "Error_Message": ""<br><br>}<br><br>\],<br><br>"ACSTableOutput": {}<br><br>}<br><br>} |

Επεξήγηση παραμέτρων

|     |     |
| --- | --- |
| "Company_ID" | μοναδικός κωδικός που δίνεται από την ACS |
| "Company_Password" | μοναδικός κωδικός που δίνεται από την ACS |
| "User_ID" | μοναδικός κωδικός που δίνεται από την ACS |
| "User_Password" | μοναδικός κωδικός που δίνεται από την ACS |
| "Pickup_Date" | η ημερομηνία παραλαβής των αποστολών από τον courier. Καταχώρηση ως’’YYYY-MM-DD’’ |

|     |     |
| --- | --- |
| "Sender" | η επωνυμία του αποστολέα |
| "Recipient_Name" | η επωνυμία του παραλήπτη |
| "Recipient_Address" | η οδός του παραλήπτη |
| "Recipient_Address_Number" | ο αριθμός της οδού του παραλήπτη |
| "Recipient_Zipcode" | το ΤΚ του παραλήπτη |
| "Recipient_Region" | η περιοχή του παραλήπτη |
| "Recipient_Phone" | το σταθερό τηλέφωνο του παραλήπτη |
| "Recipient_Cell_Phone" | το κινητό τηλέφωνο του παραλήπτη |
| "Recipient_Floor" | ο όροφος του παραλήπτη |
| "Recipient_Company_Name" | η επωνυμία της εταιρίας του παραλήπτη (αν υπάρχει) |
| "Recipient_Country" | η χώρα προορισμού. Ελλάδα = GR, Κύπρος = CY |
| "Acs_Station_Destination" | ο κωδικός του καταστήματος ACS που θα εκτελέσει την παράδοση της αποστολής. Τιμή null ή τα 2 γράμματα που δίνει το Address Validation |
| "Acs_Station_Branch_Destination" | αποδεκτές τιμές ‘’0’’ ή ‘’1’’ |
| "Billing_Code" | Ο ACS επί πιστώσει κωδικός χρέωσης |
| "Charge_Type" | για χρέωση αποστολέα ‘’2’’, για παραλήπτη‘’4’’ |
| "Cost_Center_Code" | το κέντρο κόστους του επί πιστώσει κωδικού (αν υπάρχει) |
| "Item_Quantity" | τα τεμάχια ανά παραλήπτη. Αν >1 θα δημιουργηθεί πολλαπλή αποστολή |
| "Weight" | το βάρος με min αποδεκτό το 0.5 |
| "Dimension_X_In_Cm" | διάσταση σε εκατοστά |
| "Dimension_Y_in_Cm" | διάσταση σε εκατοστά |
| "Dimension_Z_in_Cm" | διάσταση σε εκατοστά |
| "Cod_Ammount" | το ποσό της Αντικαταβολής. Αν δεν υπάρχει τότε τιμή null |
| "Cod_Payment_Way" | Ο τρόπος πληρωμής της Αντικαταβολής. Για μετρητοίς τιμή **‘’0’’** , για επιταγή **‘’1’’.** Αν δεν υπάρχει COD τότε τιμή null |
| "Acs_Delivery_Products" | Κωδικοί **_(όπου \* ενδέχεται να επιφέρουν έξτρα μεταφορικά κόστη):_**<br><br>**INS Ασφάλεια Αποστολής\***<br><br>**SAT: Παράδοση Σάββατο\* MDD Πρωινή παράδοση\* TDD 2ωρη Δέσμευση ώρας\***<br><br>**COD: Αντικαταβολή\***<br><br>**RDO: Επιστροφή Δικαιολογητικών REM: Δυσπρόσιτη περιοχή\***<br><br>**PRO: Παραλαβή Πρωτοκόλλου\* REC: Παράδοση Reception**<br><br>**CEC**: **Cyprus Economy**<br><br>**P2P point to point** |

|     |     |
| --- | --- |
|     | **D2P door to point**<br><br>**P2D point to door**<br><br>**Τα κόκκινα αφορούν προϊόντα μόνο για την Κύπρο** |
| "Insurance_Ammount" | η μέγιστη τιμή €3000 αλλιώς null |
| "Delivery_Notes" | σημειώσεις παράδοσης– ελεύθερο κείμενο |
| "Appointment_Until_Time" | 2ωρη δέσμευση ώρας παράδοσης. Καταχώρηση ως ‘’hh:mm’’. Καταχώρηση HH:MM. **Ενδέχεται να επιφέρει έξτρα κόστη** |
| "Recipient_Email" | το email του παραλήπτη |
| "Reference_Key1" | 1ο πεδίο κλειδιού αποστολέα |
| "Reference_Key2" | 2ο πεδίο κλειδιού αποστολέα |
| "With_Return_Voucher" | null χωρίς επιστροφικό voucher ή ‘’1’’ για επιστροφικό voucher |
| "Language" | για ελληνικά null ή GR για αγγλικά EN |
| "Content_Type_ID" | Υποχρεωτικό αν η χώρα προορισμού είναι Κύπρος CY |

Σημειώσεις:

### Για να οριστικοποιηθούν τα τυπωμένα voucher ως αποστολές πρέπει οπωσδήποτε να δημιουργηθεί και να τυπωθεί η λίστα παραλαβής ημέρας (ενότητα Issue_Pickup_List στο documentation). Αν η λίστα παραλαβής δεν δημιουργηθεί τα barcodes των vouchers δεν θα αναγνωρίζονται.

1.  Δεν είναι υποχρεωτικά και τα 2 τηλέφωνα αρκεί είτε το σταθερό είτε το κινητό. Προτιμότερο είναι το κινητό για να μπορεί να υπάρχει αυτόματη επικοινωνία μέσω sms με τον παραλήπτη πχ. μετά από απών σημείωμα.
2.  Τα δεκαδικά στα πεδία **Cod_Ammount – Weight - Insurance_Ammount με τελεία**.

### Τα ποσά στα πεδία Cod_Ammount – Weight - Insurance_Ammount - Cod_Payment_Way- Charge_Type - Item_Quantity δίχως quotes (μονά ή διπλά).

1.  Αν δεν υπάρχει αντικαταβολή τότε τα πιο κάτω πεδία πρέπει να είναι:
    - "Cod_Ammount": null,
    - "Cod_Payment_Way": null,
    - "Acs_Delivery_Products": null,
2.  Αν στο **Item_Quantity** η τιμή >1 τότε θα παραχθούν πολλαπλά vouchers. Για να γίνει εξαγωγή και των αριθμών (αν το θέλουμε) χρειάζεται να χρησιμοποιηθεί η μέθοδος **Multipart_Vouchers** που περιγράφεται στο παρόν documentation.
3.  Αν καταχωρηθούν οι 3 διαστάσεις το εργαλείο δεν εκτελεί υπολογισμό ογκομέτρησης. Το voucher εμφανίζει πάντα το βάρος του πεδίου **Weight.**
4.  Για ποσά ασφάλειας > €3000 χρειάζεται να υπάρχει εμπορική συμφωνία business insurance.
5.  Η παράμετρος **With_Return_Voucher** δεν αφορά στην τυχόν εμπορική πολιτική επιστροφής προϊόντων (πχ. αντικαταστάσεις) αλλά στην υπηρεσία επιστροφής δικαιολογητικών (RDO) κατά την οποία ο courier παραδίδει και **ταυτόχρονα** παίρνει κάτι πίσω. **Η εκτύπωση και του επιστροφικού voucher είναι εφικτή μόνο στις θερμικές εκτυπώσεις voucher** (ενότητα **Print Voucher** στο documentation).
6.  Αν θέλουμε να καταχωρήσουμε προϊόντα >1 τα καταχωρούμε με κόμμα ‘,’ πχ. **‘COD, SAT’** ή **‘SAT, COD’** δηλ. η σειρά καταχώρησης δεν παίζει ρόλο.
7.  Δεν μπορούν να συνδυαστούν μεταξύ τους τα προϊόντα **SAT,REC.**
8.  Αν στο πεδίο **"Appointment_Until_Time"** καταχωρηθεί ώρα τότε στην αποστολή θα προστεθεί αυτόματα το προϊόν της Πρωινής παράδοσης (αν η καταχωρημένη ώρα μέχρις τις 10:00) ή 2ωρη δέσμευση (αν η καταχωρημένη ώρα >10:00).

Μηνύματα Λάθους (μπορεί μελλοντικά απροειδοποίητα να αλλάξουν):

- **Μη αποδεκτή ημ/νία παραλαβής** – όταν είναι λάθος η ημερομηνία παραλαβής πχ. παρελθοντική.
- **Δεν επιτρέπεται ημερομηνία παραλαβής ημέρα Κυριακή ή εθνική αργία -** όταν η ημερομηνία παραλαβής είναι Κυριακή ή αργία.
- **Το όνομα παραλήπτη δεν μπορεί να είναι κενό** – αν το όνομα παραλήπτη είναι κενό.
- **Η διεύθυνση δεν μπορεί να είναι κενή** – αν δεν υπάρχει διεύθυνση παράδοσης.
- **Μη αποδεκτός ταχ. Κωδικός ή χώρα προορισμού -** αν το ΤΚ είναι λάθος ή δεν ταιριάζει με το πεδίο **Recipient_Country** (πχ. υπάρχει GR αλλά το ΤΚ είναι Κυπριακό ή το αντίθετο).
- **Μη αποδεκτή τιμή καταστήματος προορισμού ACS -** αν τα αρχικά γράμματα του καταστήματος παράδοσης δεν είναι σωστά (στην περίπτωση που καταχωρείται η πληροφορία αυτή στο πεδίο **Acs_Station_Destination**) ή/και αν η τιμή στο πεδίο **Acs_Station_Branch_Destination** δεν είναι σωστή.
- **Δεν υποστηρίζονται πάνω από 99 τεμάχια ανά αποστολή** – αν από λάθος τα τεμάχια έχουν πολύ μεγάλη τιμή.
- **Μη αποδεκτή τιμή βάρους (0,5-999)** – αν από λάθος το βάρος είναι πολύ μεγάλο.
- **Μη αποδεκτή τιμή χρέωσης μεταφορικών** – αν η τιμή στο πεδίο **Charge_Type** δεν είναι 2 ή 4.
- **Μη αποδεκτός τρόπος πληρωμής αντικαταβολής** – αν ο τρόπος πληρωμής της αντικαταβολής δεν είναι 0 για μετρητά ή 1 για επιταγή.
- **Δεν βρέθηκε το προϊόν αντικαταβολής (ΑΝ)** – αν υπάρχει ποσό αντικαταβολής & τρόπος πληρωμής αλλά δεν υπάρχει η υπηρεσία **COD** στο πεδίο **Acs_Delivery_Product**.
- **Ανύπαρκτος επί πιστώσει κωδικός χρέωσης** – αν το **Billing_Code** (δηλ. ο κωδικός τιμολόγησης) είναι λάθος.
- **Σε Acs-SmartPoint προορισμό πρέπει υποχρεωτικά να υπάρχει 1 κινητό τηλ** \- αν το σημείο παράδοσης είναι Smart Point και δεν έχει καταχωρηθεί κινητό τηλέφωνο στο πεδίο **Recipient_Cellphone**.
- **Το προϊόν "RV" συνδυάζεται μόνο με επιστροφικό voucher (with_return = 1) –** αν στο πεδίο **Acs_Delivery_Products** έχει καταχωρηθεί το RVO αλλά στο πεδίο **With_Return_ Voucher** δεν υπάρχει ‘1’.
- **Δεν μπορείτε να δημιουργήσετε αποστολές Cyprus Economy (EC) σε αυτόν τον κωδικός χρέωσης: 2ΧΧΧΧΧΧΧ –** αν ο κωδικός χρέωσης δεν αφορά στην υπηρεσία EC.
- **Τα προϊόντα της αποστολής δεν συνδυάζονται μεταξύ τους –** αν τα καταχωρημένα προϊόντα δεν μπορούν να συνδυαστούν πχ. **TDD,REC** & **MDV, REC.**
- **Ο προορισμός εντοπίστηκε ως δυσπρόσιτος (ΔΠ-ΔΧ) και δεν συνδυάζεται με τα υπόλοιπα προϊόντα που δώσατε –** αν στο πεδίο **Acs_Delivery_Products** καταχωρηθεί προϊόν SAT – MDV -TDD και ο προορισμός είναι ΔΠ.
- **Δεν υποστηρίζεται το προϊόν 5Σ σε αυτόν τον προορισμό. -** αν στο πεδίο **Acs_Delivery_Products** καταχωρηθεί προϊόν SAT το οποίο δεν υποστηρίζεται για τον εν λόγω προορισμό.
- **Για αποστολές από Ελλάδα προς Κύπρο ο κωδικός περιεχομένου αποστολής (Content_Type_ID) πρέπει να έχει σωστή τιμή.** Αν η χώρα προορισμού είναι Κύπρος (CY) και δεν έχει καταχωρηθεί κωδικός περιεχομένου.

## ΠΟΛΛΑΠΛΑ VOUCHERS (πολλαπλή αποστολή)

Αν στο **Item_Quantity** της **Create Voucher** η τιμή είναι >1 τότε θα παραχθούν **πολλαπλά vouchers**. Η πολλαπλή αποστολή αποτελείται από 1 κύριο voucher & συνοδευτικά. Χρησιμοποιείται όταν το περιεχόμενο μιας αποστολής δεν χωράει σε 1 δέμα και πρέπει να

χωριστεί σε >1 συσκευασίες. Όλα τα τεμάχια πρέπει να παραδοθούν ταυτόχρονα, ο αποστολέας χρεώνεται 1 αποστολή.

Για να δούμε και τους αριθμούς αυτούς (αν το θέλουμε) χρειάζεται να χρησιμοποιηθεί η μέθοδος **Multipart_Vouchers.**

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_ Get_Multipart_Vouchers"

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα demo request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_Get_Multipart_Vouchers", "ACSInputParameters": {<br><br>"Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "Language": null, "Main_Voucher_No": 7227890681<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"Error_Message": null<br><br>}<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[<br><br>{<br><br>"MultiPart_Voucher_No": "8052453426"<br><br>}<br><br>\]<br><br>}<br><br>}<br><br>} |

Στο παράδειγμα μας έχουμε το κύριο Voucher **7227890681** στο οποίο στην **Create Voucher** είχαμε ορίσει **Item_Quantity= 2.** Η μέθοδος μας δίνει και τον κωδικό του συνοδευτικού voucher **8052453426.**

# ΕΚΤΥΠΩΣΗ VOUCHER

Χρησιμοποιείται για την δημιουργία και την εκτύπωση των vouchers σε μορφή PDF

### αναλόγως του εκτυπωτή που έχει ο πελάτης (laser ή θερμικό).Τα vouchers πρέπει να τυπώνονται πριν την εκτύπωση της λίστας παραλαβής (Pick up list) γιατί μετά δεν είναι εφικτή η εκτύπωση τους.

Παράδειγμα demo request

{

"ACSAlias": "ACS_Print_Voucher", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo',

"User_Password": 'demo', "Voucher_No": 'ΧΧΧΧΧΧΧΧΧΧ', "Print_Type": 2,

"Start_Position": 1

}

}

Για το deserialize του json στο ACSObjectOutput που παίρνετε ως response, κάθε γραμμή που επιστρέφεται είναι ένα dictionary με κλειδί το voucher και value το byte array που έχει το pdf.

Σημειώσεις:

- Για laser εκτύπωση (Α4 σελίδα) στο πεδίο **"Print_Type"** η τιμή είναι 2 ενώ για θερμική η τιμή είναι 1.
- Το πεδίο **"Start_Position"** καθορίζει την θέση της ετικέτας στην σελίδα A4. Αποδεκτές τιμές 1,2 ή 3. Έχει νόημα μόνο στην περίπτωση της laser εκτύπωσης (Print_Type=2).
- Μπορούν να τυπωθούν ως και 10 voucher ταυτόχρονα καταχωρώντας τα voucher id στο πεδίο **"Voucher_No"** χωρισμένα με κόμμα.
- Εάν η αποστολή έχει επιστροφικό voucher δηλαδή στην create voucher το πεδίο **With_Return_Voucher=1** στο πεδίο Voucher_No καταχωρείται μόνο το κύριο voucher αλλά επιστρέφεται στην εκτύπωση και το κύριο και το επιστροφικό.
- Αν στην **Create Voucher** στο πεδίο **Item_Quantity** η τιμή ήταν >1 τότε στην εκτύπωση θα εμφανιστεί το κύριο voucher αλλά και τα συνοδευτικά.

Δείγματα Vouchers

- Laser

- Θερμικό

# ΔΙΑΓΡΑΦΗ VOUCHER

Μέσω της συγκεκριμένης μεθόδου μπορούμε να διαγράψουμε ένα ή περισσότερα voucher γιατί πχ. δεν θα στείλουμε την αποστολή. **Αυτό είναι εφικτό μόνο σε περίπτωση που η αποστολή αυτή δεν έχει συμπεριληφθεί σε λίστα παραλαβής ημέρας** (ενότητα **Issue_Pickup_List** στο documentation).

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_Delete_Voucher",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα demo request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** (με χρώμα ο κωδικός της αποστολής) |
| {<br><br>"ACSAlias": "ACS_Delete_Voucher", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "Language": null,<br><br>"Voucher_No": 7227889480<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"Error_Message": null<br><br>}<br><br>\],<br><br>"ACSTableOutput": {}<br><br>}<br><br>} |

Παρατηρήσεις:

- Η διαγραφή μπορεί να εκτελείται 1 προς 1 voucher ή και μαζικά ως και 20 voucher.
- Για μαζική διαγραφή καταχωρούμε όλα τα voucher στο πεδίο "Voucher_No" και τα χωρίζουμε με κόμμα.
- Αν η αποστολή έχει πολλαπλά τεμάχια (δηλ. στην Create Voucher το **Item_Quantity>1**) η διαγραφή του κύριου voucher διαγράφει ταυτόχρονα και το/ τα συνοδευτικά.

Μήνυμα λάθους (μπορεί μελλοντικά απροειδοποίητα να αλλάξουν):

- **Δεν μπορεί να γίνει διαγραφή αποστολής ACS, όταν έχει εκτυπωθεί η λίστα παραλαβής του courier -** Αν το voucher έχει συμπεριληφθεί σε λίστα παραλαβής θεωρείται οριστικό και η διαγραφή του είναι εφικτή μόνο από την ACS κατόπιν εντολής του αποστολέα στο κατάστημα ACS που τον εξυπηρετεί ή στις κεντρικές υπηρεσίες της ACS.

# ΠΕΡΙΕΧΟΜΕΝΟ ΑΠΟΣΤΟΛΩΝ ΚΥΠΡΟΥ

Όταν η χώρα προορισμού ("Recipient_Country") στην μέθοδο create voucher είναι η Κύπρος CY, είναι **υποχρεωτική** η καταχώρηση του περιεχομένου της αποστολής (αφορά σε απόφαση του τελωνείου της Κύπρου). Η μη περιγραφή του περιεχομένου επιφέρει καθυστερήσεις αλλά και πρόστιμα από το τελωνείο της Λάρνακας.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_Get_Content_Types",

**}**

Παράδειγμα demo request – response**:**

|     |
| --- |
| **Request** |
| {<br><br>"ACSAlias": "ACS_Get_Content_Types", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo',<br><br>"User_Password": 'demo', "Language": 'GR',<br><br>}<br><br>} |

## ΛΙΣΤΑ ΠΑΡΑΛΑΒΗΣ (οριστικοποίηση vouchers)

### Η δημιουργία της λίστας παραλαβής (pickup list) είναι υποχρεωτικό βήμα προκειμένου να οριστικοποιούνται τα vouchers σε διαφορετική περίπτωση τα vouchers δεν αναγνωρίζονται από τα συστήματα της ACS.

Μέσω της μεθόδου αυτής λαμβάνουμε τον μαζικό κωδικό της λίστας παραλαβής μέσω του οποίου θα την τυπώσουμε.

Μέσα στην ημέρα μπορούμε να δημιουργήσουμε/ τυπώσουμε όσες λίστες παραλαβής επιθυμούμε.

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_ Issue_Pickup_List",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα demo request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** (με χρώμα ο μαζικός κωδικός της λίστας) |
| {<br><br>"ACSAlias": "ACS_Issue_Pickup_List", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo',<br><br>"Language": 'GR', | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"PickupList_No": "7227889830",<br><br>"Unprinted_Found": 0, |

|     |     |
| --- | --- |
| "Pickup_Date": '2019-01-11', "MyData": null,<br><br>}<br><br>} | "Error_Message": ""<br><br>}<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[\]<br><br>}<br><br>}<br><br>} |

Στο παράδειγμα μας για την ημερομηνία 11/01/2019 έχουμε 1 λίστα παραλαβής με κωδικό μαζικού το **7227889830.**

Παρατηρήσεις:

- Στο πεδίο **Pickup_Date** καταχωρούμε την ημερομηνία έκδοσης της λίστας. Η ημερομηνία αυτή πρέπει να είναι ίδια με την ημερομηνία δημιουργίας των vouchers.
- Στο πεδίο **MyData** αν η τιμή = 0 κλείνει τις αποστολές όλων των χρηστών, αν= 1 κλείνει τις αποστολές μόνο του χρήστη με το συγκεκριμένο username (χρήσιμο μόνο αν οι χρήστες >1)

Μήνυμα Λάθους (μπορεί μελλοντικά απροειδοποίητα να αλλάξουν):

- **Αδύνατη η έκδοση λίστας παραλαβής. Βρέθηκαν X ατύπωτες αποστολές –** αν υπάρχουν ατύπωτα vouchers (δηλ. δεν καλέσαμε για αυτά την μέθοδο Print Voucher). Στην περίπτωση αυτή στο response θα εμφανίζεται το πλήθος των ατύπωτων vouchers καθώς και οι κωδικοί τους.

Παράδειγμα:

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_Issue_Pickup_List", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "Language": 'GR',<br><br>"Pickup_Date": '2019-01-11', "MyData": null,<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"PickupList_No": null, "Unprinted_Found": 2,<br><br>"Error_Message": "Αδύνατη η έκδοση λίστας παραλαβής.<br><br>Βρέθηκαν 2 ατύπωτες αποστολές."<br><br>}<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[<br><br>{<br><br>"Unprinted_Vouchers": "7227889841"<br><br>},<br><br>{<br><br>"Unprinted_Vouchers": "7227889874"<br><br>}<br><br>\]<br><br>}<br><br>}<br><br>} |

Στην περίπτωση αυτή θα πρέπει τα vouchers αυτά είτε να τα τυπώσουμε είτε να τα διαγράψουμε και κατόπιν να εκτελέσουμε πάλι την εντολή δημιουργίας της λίστας παραλαβής για να πάρουμε το **PickupList_No**.

# ΕΚΤΥΠΩΣΗ ΛΙΣΤΑΣ ΠΑΡΑΛΑΒΗΣ

Η εκτύπωση της λίστας παραλαβής (pickup list) σε PDF γίνεται από την μέθοδο

### "ACS_Print_Pickup_List"

Παράδειγμα demo request

{

"ACSAlias": "ACS_Print_Pickup_List", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "Language": 'GR',

"Mass_Number": XXXXXXXXXX, "Pickup_Date": '2020-10-01'

}

}

Παρατηρήσεις:

- Στο πεδίο "Mass_Number" όπου ΧΧΧΧΧΧΧΧΧΧ το **PickupList_No** που δίνει η μέθοδος

### ACS_ Issue_Pickup_List

Παράδειγμα λίστας παραλαβής

Επάνω αριστερά το barcode που αντιστοιχεί στον μαζικό κωδικό **PickupList_No.**

# ΕΜΦΑΝΙΣΗ ΛΙΣΤΩΝ ΠΑΡΑΛΑΒΗΣ ΗΜΕΡΑΣ

Αν για οποιοδήποτε λόγο πρέπει να γίνει επανεκτύπωση μίας λίστας παραλαβής μπορεί να χρησιμοποιηθεί η μέθοδος **Get_Pickup_Lists** για συγκεκριμένη ημερομηνία που θα επιστρέψει όλους τους μαζικούς αριθμούς (**PickupList_No**) που εκδόθηκαν για αυτή την ημερομηνία.

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS Get_Pickup_Lists",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα demo request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_Get_Pickup_Lists", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "Language": null,<br><br>"Pickup_Date": '2019-01-15'<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"Error_Message": null<br><br>}<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[<br><br>{<br><br>"Pickup_date": "2019-01-15T00:00:00",<br><br>"Pickup_List_DateTime": "2019-01-15T11:05:03.943", "User_ID": "demo",<br><br>"PickupList_No": "7227890935",<br><br>"List_Vouchers_Count": 2<br><br>},<br><br>{<br><br>"Pickup_date": "2019-01-15T00:00:00",<br><br>"Pickup_List_DateTime": "2019-01-15T11:05:34.11", "User_ID": "demo",<br><br>"PickupList_No": "7227890950",<br><br>"List_Vouchers_Count": 1<br><br>}<br><br>\]<br><br>}<br><br>}<br><br>} |

Στο παράδειγμα μας για την ημερομηνία 2019-01-15 υπάρχουν 2 λίστες παραλαβής. Στο response εμφανίζονται οι μαζικοί κωδικοί των λιστών (PickupList_No), η ημερομηνία (Pickup_date) και η ώρα (Pickup_List_DateTime) που είχαν δημιουργηθεί καθώς και το πλήθος των αποστολών που περιέχει η κάθε μία (List_Vouchers_Count).

Οι μαζικοί κωδικοί των λιστών (PickupList_No) αν καταχωρηθούν (ένας – ένας) στο link της εκτύπωσης της Λίστας Παραλαβής θα έχουμε την επανεκτύπωση τους.

Η επανεκτύπωση της λίστας παραλαβής μπορεί να γίνει για ως και 6 μήνες πίσω.

# ΕΜΦΑΝΙΣΗ ΑΠΟΣΤΟΛΩΝ ΛΙΣΤΑΣ ΠΑΡΑΛΑΒΗΣ

Η εν λόγω μέθοδος εμφανίζει τα vouchers που περιέχονται σε μια λίστα παραλαβής (pickup list) καθώς και τα αντίστοιχα Reference_Key1- Reference_Key2 (αν συμπληρώθηκαν στην μέθοδο create voucher).

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_Pickup_List_Display_Voucher"

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα demo request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_Pickup_List_Display_Voucher", "ACSInputParameters": {<br><br>"Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "Language": null, "PickupList_No": XXXXXXXXX, "Pickup_Date": '2019-01-15'<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"List_Vouchers_Count": 1, "Error_Message": null<br><br>}<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[<br><br>{<br><br>"Voucher_no": "XXXXXXXXXX", "Reference_Key1": null, "Reference_Key2": null<br><br>}<br><br>\]<br><br>}<br><br>}<br><br>} |

# ΑΝΑΛΥΣΗ ΑΠΟΔΟΣΗΣ ΑΝΤΙΚΑΤΑΒΟΛΩΝ

Η εν λόγω μέθοδος εμφανίζει πληροφορίες σχετικές με την απόδοση των αντικαταβολών στον τραπεζικό λογαριασμό του πελάτη. Εμφανίζονται τα vouchers, τα ποσά των αντικαταβολών που αποδώσαμε καθώς και ο τρόπος είσπραξης των αντικαταβολών (δηλ. αν ο παραλήπτης πλήρωσε μετρητοίς ή με κάρτα). **Χρήσιμη για το κλείσιμο παραγγελιών στο σύστημα του πελάτη.**

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": " ACS_COD_Beneficiary_Info"

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα demo request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_COD_Beneficiary_Info", "ACSInputParameters": {<br><br>"Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "User_locals": 'GR',<br><br>"COD_Payment_Date": 'ΕΕΕΕ-ΜΜ-ΗΗ'<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"Error_msg": null<br><br>}<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[<br><br>{<br><br>"Customer_Code": "2ΑΘΧΧΧΧ", "POD": "ΧΧΧΧΧΧΧΧΧΧ",<br><br>"Parcel_Sender": "Sender", "Parcel_Receiver": "Recipient ",<br><br>"Parcel_Pickup_Date": "2020-09-05T00:00:00", "Parcel_Delivery_Date": "2020-09-07T00:00:00", "Parcel_COD_Amount": 120.30, "Customer_RefNo_1": "XXXX", "Customer_RefNo_2": "",<br><br>"COD_Amount_Cach": 0.00,<br><br>"COD_Amount_CreditCard": 120.30<br><br>}, |

Σημειώσεις:

- Η ημερομηνία στο πεδίο **COD_Payment_Date** δεν φέρνει αποτελέσματα με την έννοια του από αλλά φέρνει αποτελέσματα για την συγκεκριμένη ημέρα.
- Στο response τα πεδία Customer_RefNo_1 & Customer_RefNo_2 εμφανίζουν τα όποια κλειδιά χρησιμοποιήθηκαν στην μέθοδο create voucher.

## TRACKING ΠΕΡΙΛΗΠΤΙΚΟ (Summary)

Μέσω της μεθόδου αυτής έχουμε την τελευταία ενημέρωση κατάστασης μιας αποστολής. Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_Trackingsummary",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request.

Παράδειγμα request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_Trackingsummary", "ACSInputParameters": { "Company_ID": 'XXXXXXX', "Company_Password": XXXXXXX, "User_ID": XXXXXXX,<br><br>"User_Password": XXXXXXX, | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"Error_Message": null |

|     |     |
| --- | --- |
| "Language": null, "Voucher_No": XXXXXXXXXX<br><br>}<br><br>} | }<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[<br><br>{<br><br>"voucher_no": XXXXXXXXXX, "acs_station_origin": "ΑΘ", "acs_station_origin_descr": "ΑΘΗΝΑ", "acs_station_destination": "ΑΘ", "acs_station_destination_descr": "ΑΘΗΝΑ", "pickup_date": "2018-12-21T00:00:00", "delivery_flag": 1,<br><br>"returned_flag": 0,<br><br>"delivery_date": "2018-12-21T00:00:00", "consignee": "XXXXXXXXX", "non_delivery_reason_code": "", "delivery_date_expected": "2018-12-24T00:00:00",<br><br>"delivery_info": "Η αποστολή παρεδόθη στον προορισμό της.<br><br>Ημερομηνία: 21/12/2018 Όνομα: XXXXXX", "sender": "XXXXXXXX",<br><br>"recipient": "XXXXXXXXXX", "recipient_address": "XXXXXXXXX 25",<br><br>"shipment_status": 4,<br><br>"phone_acs_station_origin": "210-8190000",<br><br>"phone_acs_station_destination": "210-8190000"<br><br>}<br><br>\]<br><br>}<br><br>}<br><br>} |

Στο παράδειγμα βλέπουμε ποια είναι η αφετηρία και ο προορισμός της αποστολής, πότε την παρέλαβε ο courier από τον αποστολέα, ποιος είναι ο αποστολέας και ο παραλήπτης, ποια είναι η διεύθυνση παράδοσης, πότε παραδόθηκε και σε ποιόν.

Επεξήγηση παραμέτρων του Response

|     |     |
| --- | --- |
| "delivery_flag" | 1= παραδομένη αποστολή, 0= απαράδοτη αποστολή |
| "returned_flag" | 1= επέστρεψε ως απαράδοτη στον αποστολέα |
| "non_delivery_reason_code" | ο κωδικός μη παράδοσης |
| "shipment_status" | Ο κωδικός της κατάστασης αποστολής |

Παρατηρήσεις:

Αν το shipment status είναι 4 πρόκειται για επιτυχημένη παράδοση αποστολής.

Οι κωδικοί μη παράδοσης στο πεδίο **non_delivery_reason_code** σε συνδυασμό με την περιγραφή στο πεδίο **delivery_info** και τον κωδικό στο πεδίο **shipment_status**:

- ΑΔ1 – Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΕΝΤΟΛΗ ΠΑΡΑΛΑΒΗΣ ΑΠΟ ΓΡΑΦΕΙΟ – STATUS 5.
- ΑΔ3 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΑΝΩΤΕΡΑ ΒΙΑ – STATUS 5.
- ΑΔ8 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΠΑΡΑΔΟΣΗ RECEPTION ΕΝΤ.ΑΠΟΣΤ – STATUS 5.
- ΑΠ1 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΑΡΝΗΣΗ ΧΡΕΩΣΗΣ - STATUS 1.
- ΑΠ2 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΑΔΥΝΑΜΙΑ ΠΛΗΡΩΜΗΣ – STATUS 1.
- ΑΠ3 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΜΗ ΑΠΟΔΟΧΗ ΑΠΟΣΤΟΛΗΣ – STATUS 1.
- ΑΣ1 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΑΠΩΝ - STATUS 3.
- ΔΔ1 – Η αποστολή βρίσκεται στην διαδρομή προς το κατάστημα παράδοσης – STATUS 5.
- ΕΑ1 - Η αποστολή βρίσκεται στην διαδρομή προς το κατάστημα παράδοσης – STATUS 5.
- ΕΔ1 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΕΛΛΙΠΗ ΔΙΚΑΙΟΛΟΓΗΤΙΚΑ – STATUS 5.

- ΛΣ1 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΑΓΝΩΣΤΟΣ ΠΑΡΑΛΗΠΤΗΣ – STATUS 2.
- ΛΣ3 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΛΑΝΘΑΣΜΕΝΗ, ΕΛΛΙΠΗΣ ΔΙΕΥΘΥΝΣΗ

\- STATUS 2.

- ΠΑ2 - Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΝΕΑ ΗΜ/ΝΙΑ ΠΑΡΑΔ ΕΝΤΟΛ ΠΑΡ/ΠΤΗ – STATUS 5.
- ΠΑ4 – Η αποστολή δεν έχει παραδοθεί με αιτία μη παράδοσης: ΕΝΤΟΛΗ ΠΑΡΑΛΗΠΤΗ ΑΝΑΚΑΤΕΥΘΥΝΣΗ - STATUS 5.

## TRACKING ΑΝΑΛΥΤΙΚΟ (Details)

Μέσω της μεθόδου αυτής έχουμε την εικόνα όλης της πορείας μιας αποστολής.

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μεθόδου μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_ TrackingDetails",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα request – response

|     |     |
| --- | --- |
| {<br><br>"ACSAlias": "ACS_TrackingDetails", "ACSInputParameters": { "Company_ID": 'XXXXXXX', "Company_Password": 'XXXXXXX', "User_ID": 'XXXXXXX',<br><br>"User_Password": 'XXXXXXX', "Language":<br><br>"Voucher_No": XXXXXXXXXX<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"Error_Message": null<br><br>}<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[<br><br>{<br><br>"checkpoint_date_time": "2019-01-11T15:38:44.153", "checkpoint_action": "ΑΝΑΧΩΡΗΣΗ ΛΑΜΙΑ", "checkpoint_location": "HUB Π.ΡΑΛΛΗ", "checkpoint_notes": " "<br><br>},<br><br>{<br><br>"checkpoint_date_time": "2019-01-12T11:37:56.247", "checkpoint_action": "ΑΦΙΞΗ ΣΕ ΚΑΤΑΣΤΗΜΑ", "checkpoint_location": "ΛΑΜΙΑ",<br><br>"checkpoint_notes": " "<br><br>},<br><br>{<br><br>"checkpoint_date_time": "2019-01-12T11:37:56.247", "checkpoint_action": "ΚΑΤΑΝΟΜΗ ΣΕ COURIER", "checkpoint_location": "ΛΑΜΙΑ",<br><br>"checkpoint_notes": " "<br><br>},<br><br>{<br><br>"checkpoint_date_time": "2019-01-12T13:37:00", "checkpoint_action": "ΠΑΡΑΔΟΣΗ", "checkpoint_location": "ΛΑΜΙΑ", "checkpoint_notes": "XXXXXXXXXX" |

# ΑΝΑΖΗΤΗΣΗ VOUCHER ΒΑΣΕΙ ΚΛΕΙΔΙΟΥ ΑΝΑΦΟΡΑΣ

Μέσω της μεθόδου αυτής είναι εφικτό να βρούμε ποιος κωδικός αποστολής αντιστοιχεί στο reference key που έχει καταχωρηθεί στο ανάλογο πεδίο της μεθόδου create voucher.

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_POD_FROM_REFERENCE_NO",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request.

Παράδειγμα request

{

"ACSAlias": "ACS_POD_FROM_REFERENCE_NO",

"ACSInputParameters": { "Company_Id": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "User_locals": 'GR', "reference_no": 'XXXXXX'

}

}

Σημειώσεις:

- Η μέθοδος επιστρέφει δεδομένα μέχρι και 2 μήνες πίσω.
- Προϋπόθεση ότι η αναζήτηση αφορά σε οριστικές αποστολές δηλ. σε αποστολές που υπάρχουν σε λίστα παραλαβής PickupList.
- Το reference key αναζήτησης πρέπει να αντιστοιχεί σε μια οριστική αποστολή/ voucher.
- Αν πρόκειται για πολλαπλή αποστολή (τεμάχια >1) τότε στην απάντηση εμφανίζεται το κύριο voucher αλλά και το υποτεμάχιο.

# ΥΠΟΛΟΓΙΣΜΟΣ ΚΟΣΤΟΥΣ

Επιστρέφει το κόστος αποστολής βάσει του τιμοκαταλόγου του πελάτη αποστολέα λαμβάνοντας υπόψη μια σειρά από παραμέτρους όπως: το είδος του προορισμού της αποστολής (πχ. εντός πόλης, νησιωτικός κλπ.), το είδος της συμπληρωματικής υπηρεσίας (πχ. αντικαταβολή, πρωινή παράδοση κλπ.), το βάρος (πραγματικό ή ογκομετρικό) κλπ.

### Δεν μπορεί να υπολογιστεί το κόστος των αποστολών προς την Κύπρο ή το εξωτερικό.

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_ Price_Calculation",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request.

Παράδειγμα request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_Price_Calculation", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "Billing_Code": '2ΑΘ999999', "Billing_Category": 2, "Acs_Station_Origin": 'ΑΘ', "Acs_Station_Destination": 'ΧΝ', "Weight": 0.5,<br><br>"Pickup_Date": '2019-01-14', "Acs_Delivery_Products": null, "Charge_Type": 2, "Delivery_Zone": null, "Insurance_Ammount": null, "Dimension_X_In_Cm": null, "Dimension_Y_In_Cm": null, "Dimension_Z_In_Cm": null, "Language": null<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"Basic_Ammount": 11.2200,<br><br>"Extra_Service_Ammount": 0.0000,<br><br>"Total_Ammount": 11.22,<br><br>"Total_Vat_Ammount": 2.69, "Info_Message": "", "Error_Message": ""<br><br>}<br><br>\],<br><br>"ACSTableOutput": {}<br><br>}<br><br>} |

Στο παράδειγμά έχουμε μια αποστολή 0.5 κιλών (δίχως διαστάσεις άρα δεν υπάρχει ογκομετρικός υπολογισμός), από Αθήνα προς Χανιά (άρα νησιωτικός προορισμός), με ημερομηνία παραλαβής 2019-01-14 και χρέωση αποστολέα (Charge_Type=2).

Παρατηρήσεις:

- Ο κωδικός του καταστήματος για το πεδίο "Acs_Station_Origin" είναι τα 2 ελληνικά κεφαλαία γράμματα που υπάρχουν στο billing code του πελάτη αποστολέα.
- Ο κωδικός στο πεδίο "Acs_Station_Destination" μπορεί να βρεθεί από την μέθοδο **Address Validation** ή **Find By Zipcode** που αναλύονται στο παρόν documentation.
- Αν καταχωρήσουμε βάρος αλλά και διαστάσεις τότε το κόστος θα είναι βάσει του πραγματικού ή του ογκομετρικού βάρους (όποιο από τα 2 είναι μεγαλύτερο).
- Το ογκομετρικό βάρος υπολογίζεται από τον τύπο: ΜΧΠΧΥ/5000.

### Το κόστος στο response είναι Κόστος Βασικής Υπηρεσίας (Basic_Ammount)|Κόστος Πρόσθετων Υπηρεσιών (Extra_Service_Ammount)|Σύνολο Χωρίς ΦΠΑ (Total_Ammount)|ΦΠΑ (Total_Vat_Ammount).

- Στο πεδίο **Billing_Category** η τιμή είναι πάντα 2.
- Στο πεδίο **Charge_Type** οι τιμές είναι 2 για χρέωση αποστολέα και 4 παραλήπτη.
- Το πεδίο **"Delivery_Zone"** δεν έχει πρακτική εφαρμογή.
- Στο πεδίο **Acs_Delivery_Products** μπορούν να καταχωρηθούν οι κωδικοί των προϊόντων Ελλάδας.

**INS Ασφάλεια Αποστολής**

**SAT: Παράδοση Σάββατο**

**COD: Αντικαταβολή**

**RDO: Επιστροφή Δικαιολογητικών**

**REM: Δυσπρόσιτη περιοχή (μέσω της μεθόδου ACS_Area_Find_By_Zip_Code) PRO: Παραλαβή Πρωτοκόλλου**

**REC: Παράδοση Reception**

- Το πεδίο **Insurance_Amount δίχως quotes (μονά ή διπλά)**. Αφορά στο ποσό ασφαλείας, για τη περίπτωση που ζητηθεί πρόσθετη ασφάλεια του μεταφερόμενου είδους. π.χ. 550.50 ευρώ. Μέγιστη αποδεκτή τιμή μέχρι και €3000. **Τα τυχόν δεκαδικά με τελεία.**

Μηνύματα Λάθους (μπορεί μελλοντικά απροειδοποίητα να αλλάξουν):

- **Άγνωστο κατάστημα παραλαβής –** αν η κωδικοποίηση του καταστήματος αφετηρίας δεν είναι σωστή.
- **Άγνωστο κατάστημα παράδοσης –** αν η κωδικοποίηση του καταστήματος προορισμού δεν είναι σωστή.
- **Για ποσά ασφάλισης μεγαλύτερα των 3000€ παρακαλούμε επικοινωνήστε με την ACS –** αν το ποσό στο **Insurance_Amount** είναι >€3000.
- **Για βάρη Μεγαλύτερα των 100 κιλών παρακαλώ επικοινωνήστε τηλεφωνικά μαζί μας –** αν το βάρος στο πεδίο **Weight** είναι >100 κιλών ή οι διαστάσεις αντιστοιχούν σε ογκομετρικό βάρος >100 κιλών.

# ΕΛΕΓΧΟΣ ΔΙΕΥΘΥΝΣΗΣ ΠΡΟΟΡΙΣΜΟΥ

Η μέθοδος επιστρέφει λίστα από πιθανές έγκυρες διευθύνσεις ή την μια και μοναδική έγκυρη διεύθυνση βάσει συνδυασμού στοιχείων όπως της οδού, του αριθμού, του ΤΚ και της περιοχής.

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_ Address_Validation",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_Address_Validation", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo',<br><br>"User_Password": 'demo', "Language": null,<br><br>"Address": 'ΔΩΔΕΚΑΝΗΣΟΥ 25 13231'<br><br>"AddressID": null<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"ACSObjectOutput": \[<br><br>{<br><br>"GeoID": 631466,<br><br>"Resolved_Street": "ΔΩΔΕΚΑΝΗΣΟΥ", "Resolved_Street_Num": "25",<br><br>"Resolved_Zip": "13232", "Resolved_Area": "ΠΕΤΡΟΥΠΟΛΗ", "Resolved_Long": 23.67857,<br><br>"Resolved_Lat": 38.04628,<br><br>"Resolved_GeoDataType": 1,<br><br>"Resolved_GeoDataID": 631466,<br><br>"Resolved_Station_ID": "ΒΘ", |

|     |     |
| --- | --- |
|     | "Resolved_Branch_ID": 1,<br><br>"Resolved_As_Inaccesible_Area_With_Cost": 0,<br><br>"Resolved_As_Inaccesible_Area_WithOut_Cost": 0,<br><br>"Resolved_Confidence": 0,<br><br>"Resolved_GeoRegionType": 1, "Resolved_Providence": "Ν. ΑΤΤΙΚΗΣ", "Resolved_Correction": "110",<br><br>"Resolved_Station_Descr": "ΑΓΙΟΙ ΑΝΑΡΓΥΡΟΙ (210-2693523 & 210-2693553)"<br><br>"AddressID": ""<br><br>}<br><br>\]<br><br>}<br><br>\],<br><br>"ACSTableOutput": {}<br><br>}<br><br>} |

Παρατηρήσεις:

- Η καταχώρηση της διεύθυνσης πρέπει να είναι στα ελληνικά **και όχι με λατινικούς χαρακτήρες.**
    - δεν πειράζει η διεύθυνση να είναι ανορθόγραφη, με κεφαλαία ή με μικρά και τόνο κλπ. αρκεί να είναι στα ελληνικά.
- Στην διεύθυνση καταχωρούμε:

### ΟΔΟ – ΑΡΙΘΜΟ – ΤΚ – ΠΕΡΙΟΧΗ ήΟΔΟ – ΑΡΙΘΜΟ – ΠΕΡΙΟΧΗ – ΤΚ ήΟΔΟ – ΑΡΙΘΜΟ – ΤΚ ήΟΔΟ – ΑΡΙΘΜΟ – ΠΕΡΙΟΧΗ

- Για κάθε διεύθυνση επιστρέφει μεταξύ άλλων, στοιχεία όπως το γεωγραφικό στίγμα καθώς και το κατάστημα της ACS (κωδικό και περιγραφή) που εξυπηρετεί την διεύθυνση.
- Το σημείο εξυπηρέτησης **Resolved_Station_ID** μπορεί να χρησιμοποιηθεί στην μέθοδο **Price Calculation** ως ο κωδικός αφετηρίας ή και προορισμού μιας αποστολής.
- Το πεδίο **AddressID** δεν είναι υποχρεωτικό αλλά μπορεί να βοηθήσει στην περίπτωση πολλών αποτελεσμάτων έτσι ώστε να εντοπίσουμε την επιθυμητή. Μπορεί να πάρει οποιαδήποτε τιμή.
- To **ACSInputParameters** στο request μπορεί να εμπεριέχει πολλαπλά δεδομένα για ταχύτερη εκτέλεση.

# ΑΝΑΖΗΤΗΣΗ ΒΑΣΕΙ ΤΚ

Η μέθοδος ελέγχει την ορθότητα **μόνο του ΤΚ**. Μπορεί να εμφανίσει είτε όλες τις περιοχές είτε μόνο τις δυσπρόσιτες περιοχές (ΔΠ) του ΤΚ αναζήτησης.

Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "ACS_ Area_Find_By_Zip_Code",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα request – response

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_Area_Find_By_Zip_Code", "ACSInputParameters": {<br><br>"Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo', "Zip_Code": null, "Show_Only_Inaccessible_Areas": 0, "Language": 'GR',<br><br>"Country": 'GR'<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"Error_Message": null<br><br>}<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[<br><br>{<br><br>"Description": "ΑΓΙΑ ΤΡΙΑΔΑ ΠΑΡΝΗΘΑΣ", "Area": "ΑΓΙΑ ΤΡΙΑΔΑ ΠΑΡΝΗΘΑΣ",<br><br>"Description_Eng": "AGIA TRIADA PARNITHAS", "Zip_Code": "13679",<br><br>"Municipality": "", "Prefecture": "Ν. ΑΤΤΙΚΗΣ", "Station_ID": "ΒΑ", "Branch_ID": 1, "Inaccessible_Area_Kind": "ΔΠ"<br><br>},<br><br>{<br><br>"Description": "ΑΜΥΓΔΑΛΕΖΑ", "Area": "ΑΜΥΓΔΑΛΕΖΑ",<br><br>"Description_Eng": "AMIGDALEZA", "Zip_Code": "13679",<br><br>"Municipality": "", "Prefecture": "Ν. ΑΤΤΙΚΗΣ", "Station_ID": "ΒΑ", "Branch_ID": 1, "Inaccessible_Area_Kind": ""<br><br>},<br><br>{<br><br>"Description": "ΞΕΝΙΑ ΠΑΡΝΗΘΑΣ", "Area": "ΞΕΝΙΑ ΠΑΡΝΗΘΑΣ",<br><br>"Description_Eng": "KSENIA PARNITHAS", "Zip_Code": "13679",<br><br>"Municipality": "", "Prefecture": "Ν. ΑΤΤΙΚΗΣ", "Station_ID": "ΒΑ", "Branch_ID": 1, "Inaccessible_Area_Kind": "ΔΠ"<br><br>},<br><br>{<br><br>"Description": "ΠΑΡΝΗΘΑ", "Area": "ΠΑΡΝΗΘΑ",<br><br>"Description_Eng": "PARNITHA", "Zip_Code": "13679",<br><br>"Municipality": "", "Prefecture": "Ν. ΑΤΤΙΚΗΣ", "Station_ID": "ΒΑ", "Branch_ID": 1, "Inaccessible_Area_Kind": "ΔΠ"<br><br>}<br><br>\]<br><br>}<br><br>}<br><br>} |

Σημειώσεις:

- Στο πεδίο Country οι αποδεκτές τιμές είναι GR για Ελλάδα, CY για Κύπρο, BG για Βουλγαρία και AL για Αλβανία.

- Για την Βουλγαρία και την Αλβανία εμφανίζεται μόνο από 1 ΤΚ.
- Στο πεδίο **Show_Only_Inaccessible_Areas** αν η τιμή είναι 0 εμφανίζονται όλες οι περιοχές ενώ αν είναι 1 τότε εμφανίζονται μόνο οι ΔΠ (δυσπρόσιτες). **Αυτό το φίλτρο ισχύει μόνο για χώρα Ελλάδα "Country": 'GR'.**
- Όσες περιοχές είναι δυσπρόσιτες στο response έχουν την ένδειξη ΔΠ στο πεδίο

### Inaccessible_Area_Kind.

- Στο πεδίο **Zip_Code** αν η τιμή είναι 0 ή null τότε στο response θα υπάρχουν όλα τα ΤΚ και οι περιοχές της επιλεγμένης χώρας.

Μηνύματα Λάθους (μπορεί μελλοντικά απροειδοποίητα να αλλάξουν):

- **Δεν βρέθηκαν δεδομένα με αυτά τα κριτήρια.** Όταν πχ. το ΤΚ είναι ανύπαρκτο ή έχει οριστεί το φίλτρο 1 στο πεδίο Show_Only_Inaccessible_Areas για ένα ΤΚ στο οποίο δεν υπάρχει καμία ΔΠ (δυσπρόσιτη) περιοχή.

# ΣΤΟΙΧΕΙΑ ΚΑΤΑΣΤΗΜΑΤΩΝ ACS

Η μέθοδος αφορά στην αναζήτηση των στοιχείων καταστημάτων της ACS στην Ελλάδα. Το request της μεθόδου το δημιουργούμε βάσει του κεφαλαίου **ΕΝΑΡΞΗ INSOMNIA**.

Για να δούμε τις παραμέτρους της μέθοδο μπορούμε στο url να καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoResthelp και στο body το όρισμα:

**{**

### "ACSAlias": "Acs_Stations",

**}**

Διαφορετικά (γνωρίζοντας ήδη τις παραμέτρους) αν στο url καταχωρήσουμε το https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest μπορούμε να εκτελέσουμε άμεσα το request

Παράδειγμα request – response**:**

|     |     |
| --- | --- |
| **Request** | **Response** |
| {<br><br>"ACSAlias": "ACS_Stations", "ACSInputParameters": { "Company_ID": 'demo', "Company_Password": 'demo', "User_ID": 'demo', "User_Password": 'demo',<br><br>"language": 'GR', "ACS_SHOP_COUNTRY_ID": 'GR', "ACS_SHOP_KIND": 1<br><br>}<br><br>} | {<br><br>"ACSExecution_HasError": false, "ACSExecutionErrorMessage": "", "ACSOutputResponce": { "ACSValueOutput": \[<br><br>{<br><br>"error_message": null<br><br>}<br><br>\],<br><br>"ACSTableOutput": { "Table_Data": \[<br><br>{<br><br>"ACS_SHOP_COUNTRY_ID": 1, "ACS_SHOP_COUNTRY_DESCR": "ΕΛΛΑΔΑ", "ACS_SHOP_AREA_ID": 19, "ACS_SHOP_AREA_DESCR": "ΘΕΣΣΑΛΟΝΙΚΗΣ ", "ACS_SHOP_STATION_ID": "ΘΔ", "ACS_SHOP_STATION_ID_EN": "SDK", "ACS_SHOP_STATION_DESCR": "ΑΓ. ΔΗΜΗΤΡΙΟΥ", "ACS_SHOP_BRANCH_ID": 1,<br><br>"ACS_SHOP_ADDRESS": "ΑΓ.ΔΗΜΗΤΡΙΟΥ 28-30, 54630",<br><br>"ACS_SHOP_ZIPCODE": "54630",<br><br>"ACS_SHOP_PHONES": "2310-251604 & 2310-257286", "ACS_SHOP_FAX": "",<br><br>"ACS_SHOP_WORKING_HOURS": "08:00-20:00", |

|     |     |
| --- | --- |
|     | "ACS_SHOP_WORKING_HOURS_SATURDAY": "08:00-15:00",<br><br>"ACS_SHOP_TRUCK_PICKUP_HOURS": "19:30",<br><br>"ACS_SHOP_TRUCK_PICKUP_HOURS_SATURDAY": "15:00",<br><br>"ACS_SHOP_LAT": "40.6419851",<br><br>"ACS_SHOP_LONG": "22.9403949",<br><br>"ACS_SHOP_DELIVERY_START_HOUR": "08:30",<br><br>"ACS_SHOP_COORDINATES_VERIFIED": 1,<br><br>"ACS_SHOP_KIND": 1,<br><br>"ACS_SHOP_SERVICES": "Όλες οι Υπηρεσίες", "ACS_SHOP_EMAIL": "[shops@acscourier.gr](mailto:shops@acscourier.gr)", "ACS_SHOP_PAYMENT_TYPES": "Αποδεκτή η χρήση των<br><br>τραπεζικών καρτών. Αφορά εξόφληση της αξίας του μεταφορικού έργου, των πρόσθετων υπηρεσιών ταχυμεταφοράς, των τιμολογίων πελατών με πίστωση, καθώς και την καταβολή της αξίας της αντικαταβολής των αποστολών",<br><br>"ACS_SHOP_ID_CODE": "19003110"<br><br>}, |

Σημειώσεις:

- Στο πεδίο **language** αν η τιμή είναι **GR** επιστρέφονται αποτέλεσμα στα ελληνικά και αν **EN** στα αγγλικά.
- Στο πεδίο **ACS_SHOP_COUNTRY_ID** αν η τιμή είναι **GR** επιστρέφονται αποτέλεσμα των Ελληνικών καταστημάτων και αν είναι **CY** των Κυπριακών.
- Στο πεδίο **ACS_SHOP_KIND** και για χώρα **GR**, αν η τιμή είναι**:**
    - **1** επιστρέφονται τα κεντρικά καταστήματα.
    - **2 ή 3** επιστρέφονται υποκαταστήματα.
    - **4** επιστρέφονται τα ACS Xpress points που εκτελούν μόνο παραλαβές μετρητοίς.
    - **5** επιστρέφονται τα ACS Kiosks για παραλαβή μόνο τυποποιημένων φακέλων.
    - **7** εμφανίζονται τα ACS Smartpoints για παραλαβή τυποποιημένων φακέλων/δεμάτων, βάρους έως 6kg.
- Στο πεδίο **ACS_SHOP_KIND** και για χώρα **CY**, αν η τιμή είναι**:**
    - **1** επιστρέφονται τα κεντρικά καταστήματα.
    - **2 ή 3** δεν επιστρέφεται τίποτα.
    - **4** επιστρέφονται τα ACS Shop in a Shop.
    - **5** δεν επιστρέφεται τίποτα.
    - **7** δεν επιστρέφεται τίποτα.

# GENERATE CLIENT CODE

Μέσω του INSOMIA με δεξί κλικ στο request μπορούμε να δούμε τις επιλογές

Επιλέγοντας την επιλογή **Generate Code** έχουμε την λίστα

Από την οποία μπορούμε να επιλέξουμε την γλώσσα που θέλουμε και να δούμε πώς διαμορφώνεται το κάθε request.