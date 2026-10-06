import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('presets',Path(__file__).with_name('import-item-presets.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class PresetImportTests(unittest.TestCase):
    def test_verified_currency_cells(self):
        line=module.priced_row(['Fabric - Prasa',144,'R',351,'R',50544])
        self.assertEqual(line['price'],351);self.assertEqual(line['qty'],144)
    def test_bad_totals_and_headers_rejected(self):
        self.assertIsNone(module.priced_row(['Glue',20,143,2850]))
        self.assertIsNone(module.priced_row(['Grand Total',1,143,143]))
        self.assertIsNone(module.priced_row(['Unpriced glue',20,None,2860]))
        self.assertIsNone(module.priced_row(['600952243055',1,2,2]))
        self.assertIsNone(module.priced_row(['F7229',1,5,5]))
        self.assertIsNone(module.priced_row(['300ml Coke',1,26,26]))
        self.assertIsNone(module.priced_row(['Veggies Small',1,46.95,46.95]))
    def test_whole_jobs_are_not_material_rates(self):
        self.assertEqual(module.category('Supply fabric and reupholster arm chair'),'Other')
        self.assertEqual(module.category('Wingback - Fabric (Hertex)'),'Fabric')
        self.assertEqual(module.category('Consumables - Foam, Decron, Webbing, etc.'),'Consumables')
        self.assertEqual(module.category('Cut & Stitch'),'Labour')
        self.assertEqual(module.category('Dining Chair-Fabric'),'Fabric')
    def test_item_codes_do_not_become_descriptions(self):
        self.assertEqual(module.clean_desc('1001-01 Outdoor Seat Cushions'),'Outdoor Seat Cushions')
    def test_local_and_english_currency_formats(self):
        for value in ['50,544.00','50.544,00','50 544,00','50544']:
            self.assertEqual(module.number(value),50544)
        self.assertEqual(module.number('R 351,00'),351)
        self.assertEqual(module.number('2,655'),2655)
    def test_source_dates_are_read_from_document_headers(self):
        self.assertEqual(module.source_date('Date generated | 2026-04-29 00:00:00'),'2026-04-29')
        self.assertEqual(module.source_date('DATE: 29/04/2026'),'2026-04-29')
        self.assertEqual(module.source_date('DATE: 31/02/2026'),'')
if __name__=='__main__':unittest.main()
