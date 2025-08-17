🔧 API Endpoints Summary
Method Endpoint Purpose Access
POST /assignments/submit Student submit assignment Students
GET /assignments/my Student's own submissions Students
GET /assignments/available Available assignments for enrolled courses Students
GET /assignments/:id Assignment details All authenticated
GET /assignments/:id/status Student's status for specific assignment Students
POST /assignments/create Admin create assignment Admins only
GET /assignments/admin/created Admin's created assignments Admins only
POST /assignments/admin/update Admin update assignment Admins only
GET /assignments/assigned Admin's assigned submissions Admins only
POST /assignments/review Admin review submissions Admins only
