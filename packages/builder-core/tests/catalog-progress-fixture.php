<?php
define( 'ABSPATH', __DIR__ . '/' );
function add_action() {}
function absint( $value ) { return abs( (int) $value ); }
require __DIR__ . '/../../../wordpress/bootstrap/site-starter-bootstrap.php';
$payload = array( 'attributes' => array_fill( 0, 47, array() ), 'terms' => array_fill( 0, 789, array() ), 'assets' => array_fill( 0, 719, array() ), 'content' => array_fill( 0, 171, array() ) );
$results = array();
foreach ( array( array(), array( 'phase' => 'terms', 'index' => 123 ), array( 'phase' => 'assets', 'index' => 42 ), array( 'phase' => 'verify', 'index' => 171 ) ) as $state ) $results[] = MMS_WP_Starter_Bootstrap::catalog_progress( $payload, $state );
echo json_encode( $results );
